import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SessionPhase, type HostApiV1, type HostSnapshotV1 } from '@chain/casino-sdk/guest';
import {
  TourStatus,
  decodeGameData,
  decodeTour,
  ejectTour,
  encodeEject,
  encodeGameData,
  encodeLaunch,
  flownRoute,
  launchLeg,
  resolveLeg,
  rollUniformBps,
  startTour,
  type BodyId,
  type Tour,
} from './slingshot';

// Minimum time a leg stays "in flight" on screen, so the approach animation always plays
// before the VRF result is revealed, however fast the chain answers.
const MIN_BURN_MS = 1800;
const OUTCOME_MS = 1500;
const DEMO_VRF_MS = 900;
const HISTORY_LIMIT = 12;

export type Busy = 'opening' | 'launch' | 'eject' | null;

export interface Round {
  id: number; // local identity, so stale timers never touch a newer round
  sessionKey: string | null;
  sessionId: string | null;
  wager: bigint;
  firstBody: BodyId;
  truth: Tour | null; // latest known chain (or demo engine) state
  shown: Tour; // what the UI presents; lags truth while a burn animation plays
  busy: Busy;
  burnStartedAt: number;
  revealed: boolean;
  aborted: 'forfeited' | 'cancelled' | null;
  abortPayout: bigint;
}

export interface HistoryEntry {
  key: string;
  route: BodyId[];
  status: number;
  wager: bigint;
  payout: bigint;
}

const TERMINAL = new Set<number>([SessionPhase.SETTLED, SessionPhase.FORFEITED, SessionPhase.CANCELLED]);
const OPEN = new Set<number>([SessionPhase.WAITING_PLAYER_ACTION, SessionPhase.WAITING_RANDOMNESS]);

export const isTerminalTour = (tour: Tour) =>
  tour.status === TourStatus.CAPTURED || tour.status === TourStatus.EJECTED || tour.status === TourStatus.COMPLETE;

// Monotonic progress so stale snapshots never rewind an optimistic launch.
const progress = (tour: Tour) => tour.legs * 2 + (tour.status === TourStatus.BURNING ? 0 : 1) + (isTerminalTour(tour) ? 1 : 0);

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useGrandTour(hostApi: HostApiV1 | null, snapshot: HostSnapshotV1 | null) {
  const [round, setRound] = useState<Round | null>(null);
  const [sceneKey, setSceneKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [demoHistory, setDemoHistory] = useState<HistoryEntry[]>([]);
  const [demoBalance, setDemoBalance] = useState<bigint>(100n * 10n ** 18n);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const nextRoundId = useRef(1);
  const revealScheduledFor = useRef(0);
  const resumeChecked = useRef(false);
  const isHost = hostApi !== null;

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const bumpScene = useCallback(() => setSceneKey(k => k + 1), []);

  // Demo engine: resolve the in-flight leg with a CSPRNG roll after a VRF-like delay.
  const demoResolve = useCallback(
    (roundId: number, wager: bigint) =>
      later(() => {
        setRound(r =>
          r && r.id === roundId && r.truth?.status === TourStatus.BURNING
            ? { ...r, truth: resolveLeg(r.truth, rollUniformBps(), wager) }
            : r
        );
      }, DEMO_VRF_MS),
    [later]
  );

  const start = useCallback(
    async (firstBody: BodyId, wager: bigint) => {
      if (wager <= 0n) return;
      setError(null);
      const id = nextRoundId.current++;
      const tour = startTour(firstBody);
      setRound({
        id,
        sessionKey: null,
        sessionId: null,
        wager,
        firstBody,
        truth: isHost ? null : tour,
        shown: tour,
        busy: isHost ? 'opening' : null,
        burnStartedAt: performance.now(),
        revealed: false,
        aborted: null,
        abortPayout: 0n,
      });
      bumpScene();
      if (!hostApi) {
        setDemoBalance(b => b - wager);
        demoResolve(id, wager);
        return;
      }
      try {
        const { sessionKey } = await hostApi.openSession({ wager: wager.toString(), gameData: encodeGameData(firstBody) });
        setRound(r => (r && r.id === id ? { ...r, sessionKey, busy: null } : r));
      } catch (err: unknown) {
        setRound(r => (r && r.id === id ? null : r));
        bumpScene();
        setError(`Launch failed: ${errorText(err)}`);
      }
    },
    [hostApi, isHost, bumpScene, demoResolve]
  );

  const launch = useCallback(
    async (body: BodyId) => {
      if (!round || round.busy || round.shown.status !== TourStatus.CRUISING) return;
      setError(null);
      const next = launchLeg(round.shown, body);
      const id = round.id;
      setRound({ ...round, shown: next, truth: isHost ? round.truth : next, busy: isHost ? 'launch' : null, burnStartedAt: performance.now() });
      bumpScene();
      if (!hostApi) {
        demoResolve(id, round.wager);
        return;
      }
      try {
        if (!round.sessionId) throw new Error('Session not indexed yet, try again in a moment');
        await hostApi.submitAction({ sessionId: round.sessionId, actionData: encodeLaunch(body) });
        setRound(r => (r && r.id === id ? { ...r, busy: null } : r));
      } catch (err: unknown) {
        setRound(r => (r && r.id === id ? { ...r, shown: r.truth ?? round.shown, busy: null } : r));
        bumpScene();
        setError(`Burn failed: ${errorText(err)}`);
      }
    },
    [round, hostApi, isHost, bumpScene, demoResolve]
  );

  const eject = useCallback(async () => {
    if (!round || round.busy || round.shown.status !== TourStatus.CRUISING) return;
    setError(null);
    if (!hostApi) {
      setRound({ ...round, truth: ejectTour(round.shown, round.wager) });
      return;
    }
    const id = round.id;
    setRound({ ...round, busy: 'eject' });
    try {
      if (!round.sessionId) throw new Error('Session not indexed yet, try again in a moment');
      await hostApi.submitAction({ sessionId: round.sessionId, actionData: encodeEject() });
      setRound(r => (r && r.id === id ? { ...r, busy: null } : r));
    } catch (err: unknown) {
      setRound(r => (r && r.id === id ? { ...r, busy: null } : r));
      setError(`Eject failed: ${errorText(err)}`);
    }
  }, [round, hostApi]);

  const reset = useCallback(() => {
    setRound(null);
    bumpScene();
  }, [bumpScene]);

  // Host: fold each snapshot into the round. Derive from the row, never accumulate.
  useEffect(() => {
    if (!snapshot || !round?.sessionKey) return;
    const row = snapshot.sessions.items.find(item => item.sessionKey === round.sessionKey);
    if (!row) return;
    const tour = decodeTour(row.raw.gameState);
    const phase = row.phase ?? -1;
    setRound(r => {
      if (!r || r.sessionKey !== row.sessionKey) return r;
      let next = r.sessionId === row.sessionId ? r : { ...r, sessionId: row.sessionId };
      if (tour && (!next.truth || progress(tour) > progress(next.truth))) next = { ...next, truth: tour };
      if (TERMINAL.has(phase) && phase !== SessionPhase.SETTLED && !next.aborted) {
        const aborted = phase === SessionPhase.FORFEITED ? 'forfeited' : 'cancelled';
        next = { ...next, aborted, abortPayout: BigInt(row.payout ?? '0'), busy: null };
      }
      return next;
    });
  }, [snapshot, round?.sessionKey]);

  // Host: adopt a tour still open from an earlier visit, once per mount.
  useEffect(() => {
    if (!snapshot || !hostApi || round || resumeChecked.current) return;
    resumeChecked.current = true;
    const game = snapshot.integration.gameAddress.toLowerCase();
    const open = snapshot.sessions.items.find(
      item => item.gameAddress.toLowerCase() === game && !item.isSettled && OPEN.has(item.phase ?? -1)
    );
    const tour = decodeTour(open?.raw.gameState);
    if (!open || !tour) return;
    const firstBody = (open.raw.gameData ? decodeGameData(open.raw.gameData) : null) ?? (tour.route[0] as BodyId);
    setRound({
      id: nextRoundId.current++,
      sessionKey: open.sessionKey,
      sessionId: open.sessionId,
      wager: BigInt(open.wager ?? open.stake ?? '0'),
      firstBody,
      truth: tour,
      shown: tour,
      busy: null,
      burnStartedAt: performance.now() - MIN_BURN_MS,
      revealed: false,
      aborted: null,
      abortPayout: 0n,
    });
    bumpScene();
  }, [snapshot, hostApi, round, bumpScene]);

  // Presentation: advance `shown` to `truth`, holding a resolving burn for MIN_BURN_MS.
  useEffect(() => {
    if (!round?.truth || progress(round.truth) <= progress(round.shown)) return;
    const wait = round.shown.status === TourStatus.BURNING ? Math.max(0, round.burnStartedAt + MIN_BURN_MS - performance.now()) : 0;
    const target = round.truth;
    const id = setTimeout(() => {
      setRound(r => (r && r.truth === target ? { ...r, shown: target } : r));
      bumpScene();
    }, wait);
    return () => clearTimeout(id);
  }, [round?.truth, round?.shown, round?.burnStartedAt, bumpScene]);

  // Settlement: once per round, let the outcome animation play, then reveal and log it.
  useEffect(() => {
    if (!round || round.revealed || revealScheduledFor.current === round.id) return;
    if (!isTerminalTour(round.shown) && round.aborted === null) return;
    revealScheduledFor.current = round.id;
    const settled = round;
    later(() => {
      setRound(r => (r && r.id === settled.id ? { ...r, revealed: true } : r));
      if (hostApi && settled.sessionId) {
        hostApi.revealOutcome({ sessionId: settled.sessionId }).catch((err: unknown) => console.warn('revealOutcome failed:', err));
      }
      if (!hostApi) {
        const payout = settled.shown.payout;
        setDemoBalance(b => b + payout);
        setDemoHistory(h =>
          [{ key: `demo-${settled.id}`, route: flownRoute(settled.shown), status: settled.shown.status, wager: settled.wager, payout }, ...h].slice(
            0,
            HISTORY_LIMIT
          )
        );
      }
    }, OUTCOME_MS);
  }, [round, hostApi, later]);

  const history = useMemo<HistoryEntry[]>(() => {
    if (!hostApi || !snapshot) return demoHistory;
    const game = snapshot.integration.gameAddress.toLowerCase();
    const hideKey = round && !round.revealed ? round.sessionKey : null;
    return snapshot.sessions.items
      .filter(item => item.gameAddress.toLowerCase() === game && (item.isSettled || TERMINAL.has(item.phase ?? -1)))
      .filter(item => item.sessionKey !== hideKey)
      .map(item => {
        const tour = decodeTour(item.raw.gameState);
        return {
          key: item.sessionKey,
          route: tour ? flownRoute(tour) : [],
          status: tour?.status ?? -1,
          wager: BigInt(item.wager ?? '0'),
          payout: BigInt(item.payout ?? '0'),
        };
      })
      .slice(0, HISTORY_LIMIT);
  }, [hostApi, snapshot, round, demoHistory]);

  const clearError = useCallback(() => setError(null), []);

  return { round, sceneKey, error, clearError, start, launch, eject, reset, history, demoBalance };
}
