import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { computeMaxWager } from '@chain/casino-sdk/guest';
import { useCasinoHost } from './lib/useCasinoHost';
import { useGrandTour, isTerminalTour, type HistoryEntry, type Round } from './lib/useGrandTour';
import {
  BODIES,
  BODY_ORDER,
  MAX_LEGS,
  TourStatus,
  flownRoute,
  legalNextBodies,
  maxPayoutMultiplier,
  routeMultiplier,
  survivedRoute,
  tourPayout,
  type BodyId,
  type Tour,
} from './lib/slingshot';
import { TourCanvas, type CanvasPhase, type CanvasScene } from './components/TourCanvas';
import { BodyArt } from './components/BodyArt';
import { HowToPlay, helpAlreadySeen } from './components/HowToPlay';
import { orbitalAudio } from './audio/orbitalAudio';
import { spaceScore, type Intensity } from './audio/spaceScore';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Flame,
  Fuel,
  HelpCircle,
  History,
  Music,
  Orbit,
  Rocket,
  RotateCcw,
  Sparkles,
  Star,
  Target,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { ROUTE_PRESETS, missionDesignation, paidMultiplier, presetSummary, telemetry } from './lib/flight';
import { BADGES, addXp, dayKey, levelFor, loadCareer, rankFor, recordTour, touchDay } from './lib/career';
import { CLEAR_BONUS_XP, applyTour, loadBoard } from './lib/missions';
import { useCountUp } from './lib/useCountUp';
import { Blackbox } from './components/Blackbox';
import { CareerModal } from './components/CareerModal';
import { CRT_FILTER_ID, CrtLayer, FlightGauges } from './components/Instruments';
import { MissionsPanel } from './components/Missions';
import { SystemMap } from './components/SystemMap';
import { TitleScreen, titleAlreadySeen } from './components/TitleScreen';
import { WinCelebration, winTier, type Win } from './components/WinCelebration';

const CRT_KEY = 'grand-tour-crt';
const rankOf = (body: BodyId) => BODY_ORDER.indexOf(body);

type ToastTone = 'badge' | 'discovery' | 'mission' | 'level' | 'streak';
interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
}
const TOAST_STYLE: Record<ToastTone, { box: string; Icon: typeof Award }> = {
  badge: { box: 'border-flare-400/60 text-flare-200 shadow-flare-500/20', Icon: Award },
  discovery: { box: 'border-cyan-300/60 text-cyan-200 shadow-cyan-400/20', Icon: Sparkles },
  mission: { box: 'border-mint-400/60 text-mint-300 shadow-mint-400/20', Icon: Target },
  level: { box: 'border-nebula-400/70 text-nebula-300 shadow-nebula-500/30', Icon: Star },
  streak: { box: 'border-flare-500/60 text-flare-300 shadow-flare-500/20', Icon: Flame },
};

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch (err: unknown) {
    console.warn(`Preference ${key} unavailable:`, err);
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    window.localStorage.setItem(key, on ? '1' : '0');
  } catch (err: unknown) {
    console.warn(`Preference ${key} not saved:`, err);
  }
}

const BODY_TONE: Record<BodyId, { text: string; ring: string; chip: string }> = {
  0: { text: 'text-slate-200', ring: 'border-slate-400/70 bg-slate-400/10', chip: 'bg-slate-300/15 text-slate-200' },
  1: { text: 'text-amber-300', ring: 'border-amber-400/70 bg-amber-400/10', chip: 'bg-amber-400/15 text-amber-200' },
  2: { text: 'text-sky-300', ring: 'border-sky-400/70 bg-sky-400/10', chip: 'bg-sky-400/15 text-sky-200' },
  3: { text: 'text-nebula-300', ring: 'border-nebula-400/70 bg-nebula-500/10', chip: 'bg-nebula-500/20 text-nebula-300' },
  4: { text: 'text-cyan-200', ring: 'border-cyan-300/70 bg-cyan-300/10', chip: 'bg-cyan-300/15 text-cyan-100' },
  5: { text: 'text-blue-300', ring: 'border-blue-400/70 bg-blue-400/10', chip: 'bg-blue-400/15 text-blue-200' },
  6: { text: 'text-yellow-200', ring: 'border-yellow-200/70 bg-yellow-200/10', chip: 'bg-yellow-200/15 text-yellow-100' },
  7: { text: 'text-orange-400', ring: 'border-orange-400/70 bg-orange-500/10', chip: 'bg-orange-500/20 text-orange-200' },
};
const WAGER_PRESETS = ['0.1', '1', '5', '10'];
const TOP_PAYOUT = maxPayoutMultiplier(2);

const pct = (bps: number) => `${bps / 100}%`;
const mult = (x: number) => `x${x.toFixed(2)}`;

function useAmountFormatter(decimals: number) {
  return (value: bigint) => {
    const n = Number(formatUnits(value, decimals));
    return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(n >= 100 ? 2 : 4);
  };
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    media.addEventListener('change', update);
    update();
    return () => media.removeEventListener('change', update);
  }, [query]);
  return matches;
}

function canvasPhase(tour: Tour): CanvasPhase {
  if (tour.status === TourStatus.BURNING) return 'burning';
  if (tour.status === TourStatus.CRUISING) return 'survived';
  if (tour.status === TourStatus.CAPTURED) return 'captured';
  if (tour.status === TourStatus.EJECTED) return 'ejected';
  return 'complete';
}

function outcomeLine(round: Round, fmt: (v: bigint) => string, symbol: string) {
  const tour = round.shown;
  if (round.aborted === 'forfeited') return { tone: 'amber', title: 'TOUR FORFEITED', body: `Action window expired: paid 90% of cash-out, ${fmt(round.abortPayout)} ${symbol}` };
  if (round.aborted === 'cancelled') return { tone: 'amber', title: 'RANDOMNESS TIMED OUT', body: 'The leg never resolved, so the stake was refunded.' };
  const survived = survivedRoute(tour);
  if (tour.status === TourStatus.COMPLETE) {
    return { tone: 'gold', title: 'GRAND TOUR COMPLETE', body: `4 assists, ${mult(routeMultiplier(survived))} tour: +${fmt(tour.payout)} ${symbol}` };
  }
  if (tour.status === TourStatus.EJECTED) {
    return { tone: 'gold', title: 'EJECTED AND BANKED', body: `${survived.length} assist${survived.length > 1 ? 's' : ''} at ${mult(routeMultiplier(survived))}: +${fmt(tour.payout)} ${symbol}` };
  }
  const leg = tour.legs - 1;
  const body = BODIES[tour.route[leg]];
  return { tone: 'red', title: `CAPTURED BY ${body.name.toUpperCase()}`, body: `Leg ${leg + 1}: roll ${tour.rolls[leg]} missed the < ${body.surviveBps} corridor.` };
}

function IconButton({ title, active = true, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg border flex items-center justify-center transition-colors ${
        active ? 'bg-hull-800 border-hull-600 text-flare-300 hover:bg-hull-700' : 'bg-hull-900 border-hull-700 text-hull-600 hover:text-hull-300'
      }`}
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded border border-current/30 text-[9px] font-ui font-semibold opacity-70">{children}</kbd>;
}

/** Route tracker along the bottom of the scene: four legs as nodes on a trajectory. */
function Trajectory({ tour }: { tour: Tour | null }) {
  const flown = tour ? flownRoute(tour) : [];
  let running = 1;
  return (
    <div className="absolute inset-x-0 bottom-0 px-4 pb-3 pt-10 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none">
      <div className="relative flex items-start justify-between max-w-md mx-auto">
        <div className="absolute left-6 right-6 top-6 border-t border-dashed border-white/25" />
        {Array.from({ length: MAX_LEGS }, (_, leg) => {
          const body = flown[leg] as BodyId | undefined;
          const inFlight = tour !== null && leg === tour.legs - 1 && tour.status === TourStatus.BURNING;
          const lost = tour !== null && leg === tour.legs - 1 && tour.status === TourStatus.CAPTURED;
          const survived = body !== undefined && !inFlight && !lost;
          if (survived) running *= routeMultiplier([body]);
          const ring = body === undefined ? 'border-dashed border-white/25 bg-black/60' : lost ? 'border-red-500 bg-red-950/70' : inFlight ? 'border-cyan-300 bg-black/70 animate-pulse' : 'border-emerald-400 bg-black/70';
          return (
            <div key={leg} className="relative flex flex-col items-center w-14">
              <div className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${ring}`} title={body !== undefined && !inFlight ? `roll ${tour?.rolls[leg]} vs gate < ${BODIES[body].surviveBps}` : undefined}>
                {body === undefined ? <span className="text-white/40 text-sm">{leg + 1}</span> : <BodyArt body={body} size={38} className={lost ? 'grayscale opacity-60' : ''} />}
              </div>
              <div className={`mt-1 text-[11px] font-semibold tabular-nums ${lost ? 'text-red-400' : inFlight ? 'text-cyan-300' : survived ? 'text-emerald-300' : 'text-white/40'}`}>
                {survived ? mult(running) : lost ? 'LOST' : inFlight ? pct(BODIES[body!].surviveBps) : `LEG ${leg + 1}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BodyCard({
  body,
  selected = false,
  disabled = false,
  onClick,
  onHover,
  pays,
  note,
}: {
  body: BodyId;
  selected?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onHover?: (hovering: boolean) => void;
  pays: string;
  note?: string;
}) {
  const b = BODIES[body];
  const tone = BODY_TONE[body];
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
      disabled={disabled}
      aria-label={`${b.name}, ${pct(b.surviveBps)} survive, pays ${pays}`}
      className={`relative rounded-xl border px-1 pt-2 pb-1.5 flex flex-col items-center text-center transition-all ${
        disabled ? 'border-hull-800 bg-hull-900 opacity-40 cursor-not-allowed' : selected ? `${tone.ring} ring-1 ring-flare-400/50` : 'border-hull-700 bg-hull-850 hover:border-hull-600 hover:-translate-y-0.5'
      }`}
    >
      <span className="absolute top-1 left-1.5 text-[9px] text-hull-600">{rankOf(body) + 1}</span>
      <BodyArt body={body} size={36} className={disabled ? 'grayscale' : ''} />
      <span className={`mt-1 w-full truncate font-semibold text-[11px] leading-tight ${tone.text}`}>{b.name}</span>
      <span className="text-[9px] text-hull-400 tabular-nums">{pct(b.surviveBps)} survive</span>
      <span className={`mt-0.5 px-1.5 rounded text-[10px] font-semibold tabular-nums ${tone.chip}`}>{pays}</span>
      {note && <span className="w-full truncate text-[9px] text-hull-400">{note}</span>}
    </button>
  );
}

function FlightLog({ history, fmt, symbol }: { history: HistoryEntry[]; fmt: (v: bigint) => string; symbol: string }) {
  const label = (h: HistoryEntry) =>
    h.status === TourStatus.COMPLETE ? 'GRAND TOUR' : h.status === TourStatus.EJECTED ? 'BANKED' : h.status === TourStatus.CAPTURED ? 'CAPTURED' : 'ENDED';
  return (
    <div className="rounded-xl border border-hull-700 bg-hull-850/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] tracking-widest text-hull-400">
        <History className="w-3.5 h-3.5 text-nebula-300" /> FLIGHT LOG
      </div>
      {history.length === 0 ? (
        <div className="py-2 text-xs text-hull-600">No tours flown yet.</div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {history.slice(0, 6).map(h => (
            <li key={h.key} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-0.5 min-w-[64px]">
                {h.route.map((b, i) => (
                  <BodyArt key={i} body={b} size={16} />
                ))}
              </span>
              <span className={`font-semibold ${h.payout > 0n ? 'text-mint-400' : 'text-ember-400'}`}>{label(h)}</span>
              <span className="ml-auto tabular-nums text-hull-100">
                {h.payout > 0n ? '+' : ''}
                {fmt(h.payout)} <span className="text-hull-400">{symbol}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const { hostApi, snapshot } = useCasinoHost();
  const { round, sceneKey, error, clearError, start, launch, eject, reset, history, demoBalance, refuelDemo } = useGrandTour(hostApi, snapshot);
  const [selected, setSelected] = useState<BodyId>(1);
  const [wagerInput, setWagerInput] = useState('1');
  const [sfxOn, setSfxOn] = useState(true);
  const [musicOn, setMusicOn] = useState(() => spaceScore.isEnabled());
  const [helpOpen, setHelpOpen] = useState(() => !helpAlreadySeen());
  const [plan, setPlan] = useState<BodyId[]>([]);
  const [lastRoute, setLastRoute] = useState<BodyId[]>([]);
  const [target, setTarget] = useState<BodyId | null>(null);
  const [hovered, setHovered] = useState<BodyId | null>(null);
  const [volume, setVolume] = useState(1);
  // Counting today's visit up front keeps the day streak right on the title screen.
  const [career, setCareer] = useState(() => touchDay(loadCareer()));
  const [careerOpen, setCareerOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [board, setBoard] = useState(() => loadBoard());
  const [win, setWin] = useState<Win | null>(null);
  const [atPeriapsis, setAtPeriapsis] = useState(false);
  const [jitter, setJitter] = useState(0);
  const [titleOpen, setTitleOpen] = useState(() => !titleAlreadySeen());
  const [crtOn, setCrtOn] = useState(() => readFlag(CRT_KEY));
  const pilot = rankFor(career.lightYears);
  const pilotLevel = levelFor(career.xp);
  const recordedRound = useRef(0);
  const toastId = useRef(0);
  const pushToast = (tone: ToastTone, text: string) => {
    const id = ++toastId.current;
    setToasts(list => [...list, { id, tone, text }].slice(-4));
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 4600);
  };
  const clearWin = useCallback(() => setWin(null), []);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const decimals = snapshot?.token.decimals ?? 18;
  const symbol = hostApi ? (snapshot?.token.symbol ?? '') : 'DEMO';
  const fmt = useAmountFormatter(decimals);
  const balance = hostApi
    ? snapshot?.balances.smartVaultBalance !== undefined
      ? BigInt(snapshot.balances.smartVaultBalance)
      : undefined
    : demoBalance;
  const walletReady = !hostApi || snapshot?.wallet.status === 'ready';
  const availableHeight = snapshot?.ui.viewport?.availableHeight;
  const rootHeight = isDesktop ? (availableHeight ? `${Math.max(600, availableHeight)}px` : '100dvh') : undefined;

  const wager = useMemo(() => {
    try {
      const parsed = parseUnits(wagerInput.trim() || '0', decimals);
      return parsed > 0n ? parsed : null;
    } catch (err: unknown) {
      console.warn('Unparseable wager input:', err);
      return null;
    }
  }, [wagerInput, decimals]);

  const maxWager = useMemo(() => {
    const result = computeMaxWager(snapshot, { maxMultiplierX: maxPayoutMultiplier(selected) });
    return result.kind === 'limit' ? result.maxWager : undefined;
  }, [snapshot, selected]);

  const inTour = round !== null && !round.revealed;
  const tour = round?.shown ?? null;
  const survived = tour ? survivedRoute(tour) : [];
  const cashValue = round && tour ? tourPayout(round.wager, survived) : 0n;
  const nextBodies = round && tour && !round.busy ? legalNextBodies(tour) : [];
  const currentBody = tour ? (tour.route[tour.legs - 1] as BodyId) : selected;
  const flown = tour ? flownRoute(tour) : [];
  const followsPlan = plan.length > 0 && flown.every((b, i) => plan[i] === b);
  const planNext = followsPlan ? (plan[flown.length] as BodyId | undefined) : undefined;
  const burnTarget: BodyId | null =
    target !== null && nextBodies.includes(target) ? target : planNext !== undefined && nextBodies.includes(planNext) ? planNext : null;
  const missionRoute: number[] = round && tour ? (followsPlan ? plan : flown) : plan.length ? plan : [selected];
  const cruising = inTour && tour?.status === TourStatus.CRUISING;
  const previewBody: BodyId | null = !round || round.revealed
    ? (hovered ?? selected)
    : cruising
      ? (hovered !== null && nextBodies.includes(hovered) ? hovered : burnTarget)
      : null;
  const preview = previewBody === null
    ? null
    : { body: previewBody, label: `${mult(paidMultiplier(cruising ? [...survived, previewBody] : [previewBody]))} | ${pct(BODIES[previewBody].surviveBps)}` };
  const tel = telemetry(
    currentBody,
    !tour
      ? 'idle'
      : tour.status === TourStatus.CAPTURED
        ? 'lost'
        : !inTour
          ? 'idle'
          : tour.status === TourStatus.BURNING
            ? (atPeriapsis ? 'periapsis' : 'approach')
            : 'coast',
    jitter,
  );
  // System map: while planning, the chain is the plan (or the chosen first body); in flight, the legs survived.
  const mapBase: BodyId[] = inTour ? survived : plan.length ? plan : [selected];
  const mapLegal: BodyId[] = inTour
    ? nextBodies
    : mapBase.length < MAX_LEGS
      ? BODY_ORDER.filter(b => b !== mapBase[mapBase.length - 1])
      : [];
  const shownValue = useCountUp(round ? routeMultiplier(survived) : maxPayoutMultiplier(selected), 700);
  // Demo pilots who run dry can refuel the practice balance and keep flying.
  const demoDry = !hostApi && demoBalance < (wager ?? 10n ** 17n);
  const liveRow = round?.sessionKey ? snapshot?.sessions.items.find(item => item.sessionKey === round.sessionKey) : undefined;
  const vrfWords = liveRow?.raw.randomnessRequests?.map(r => r.randomness) ?? (liveRow?.raw.randomness ? [liveRow.raw.randomness] : []);
  const verifyVrf =
    hostApi?.getRandomnessVerification && round?.sessionId
      ? async () => {
          const v = await hostApi.getRandomnessVerification!({ sessionId: round.sessionId! });
          if (!v.supported) return 'This host does not support VRF verification yet.';
          const ok = v.requests.filter(r => r.valid).length;
          return `${ok} of ${v.requests.length} VRF proofs verified on chain ${v.chainId}.`;
        }
      : undefined;

  const launchBlocker = !walletReady
    ? 'Connect your wallet in the host'
    : wager === null
      ? 'Enter a wager'
      : balance !== undefined && wager > balance
        ? 'Wager exceeds balance'
        : maxWager !== undefined && wager > maxWager
          ? `Max bet here is ${fmt(maxWager)} ${symbol}`
          : null;

  const previewKey = preview ? `${preview.body}:${preview.label}` : '';
  const chassis = pilot.index;
  const scene: CanvasScene = useMemo(() => {
    if (!round || !tour) return { key: sceneKey, phase: 'idle', body: selected, preview, chassis };
    return { key: sceneKey, phase: canvasPhase(tour), body: tour.route[tour.legs - 1] as BodyId, preview, chassis };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, tour, sceneKey, selected, previewKey, chassis]);

  // Periapsis telemetry: flag closest approach after the approach animation, jitter the g-load.
  useEffect(() => {
    setAtPeriapsis(false);
    setTarget(null);
    if (tour?.status !== TourStatus.BURNING) return;
    const reach = setTimeout(() => setAtPeriapsis(true), 1100);
    const shakeTimer = setInterval(() => setJitter(Math.random() * 2 - 1), 150);
    return () => {
      clearTimeout(reach);
      clearInterval(shakeTimer);
    };
  }, [tour?.status, tour?.legs]);

  // Progression: fold each finished tour in once (career, codex, missions, XP), remember its
  // route for re-fly, then surface everything it earned. All of it is cosmetic.
  useEffect(() => {
    if (!round?.revealed || round.aborted || recordedRound.current === round.id) return;
    recordedRound.current = round.id;
    const route = flownRoute(round.shown);
    setLastRoute(plan.length && route.every((b, i) => plan[i] === b) ? plan : route);
    const record = recordTour(career, round.shown, round.wager);
    // The board rolls over at local midnight even if the tab stayed open.
    const missions = applyTour(board.day === dayKey() ? board : loadBoard(), round.shown, round.wager);
    const missionXp = missions.completed.reduce((xp, m) => xp + m.xp, 0) + (missions.cleared ? CLEAR_BONUS_XP : 0);
    // The day's first tour pays a streak bonus that grows with consecutive days (capped).
    const streakXp = missions.firstTourToday ? Math.min(140, 20 * Math.max(1, record.career.dayStreak)) : 0;
    const next = missionXp + streakXp > 0 ? addXp(record.career, missionXp + streakXp) : record.career;
    setCareer(next);
    setBoard(missions.board);

    for (const body of record.discoveries) pushToast('discovery', `New world charted: ${BODIES[body].name}`);
    for (const id of record.unlocked) pushToast('badge', `Badge unlocked: ${BADGES.find(b => b.id === id)?.name ?? id}`);
    for (const m of missions.completed) pushToast('mission', `Mission complete: ${m.title} +${m.xp} XP`);
    if (missions.cleared) pushToast('mission', `All daily missions clear +${CLEAR_BONUS_XP} XP`);
    if (streakXp) pushToast('streak', `Day ${next.dayStreak} flight streak +${streakXp} XP`);
    if (next.winStreak >= 3) pushToast('streak', `${next.winStreak} banks in a row`);
    const levelNow = levelFor(next.xp).level;
    if (levelNow > levelFor(career.xp).level) {
      pushToast('level', `Level ${levelNow} reached`);
      orbitalAudio.playEscapeSuccess();
    } else if (missions.completed.length || record.discoveries.length) {
      orbitalAudio.playBlip(1047);
    }
    const payout = round.shown.payout;
    if (payout > 0n && round.wager > 0n) {
      const multiple = Number((payout * 10000n) / round.wager) / 10000;
      if (winTier(multiple)) setWin({ key: round.id, multiple, amount: Number(formatUnits(payout, decimals)), symbol });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.revealed, round?.id]);

  // Music: starts on the first gesture (browser autoplay rules), then follows the tour.
  useEffect(() => {
    const kick = () => spaceScore.start();
    window.addEventListener('pointerdown', kick, { once: true });
    window.addEventListener('keydown', kick, { once: true });
    return () => {
      window.removeEventListener('pointerdown', kick);
      window.removeEventListener('keydown', kick);
    };
  }, []);
  const intensity: Intensity = !inTour || !tour ? 0 : tour.status === TourStatus.BURNING ? 3 : survived.length >= 2 ? 2 : 1;
  useEffect(() => spaceScore.setIntensity(intensity), [intensity]);

  // Sound cues follow what the player sees, not raw chain events.
  const lastCue = useRef('');
  useEffect(() => {
    if (!tour) return;
    const cue = `${sceneKey}:${tour.status}:${tour.legs}`;
    if (cue === lastCue.current) return;
    lastCue.current = cue;
    if (tour.status === TourStatus.BURNING) {
      orbitalAudio.playGravityWellHum();
      orbitalAudio.startApproachPings(1100);
      setTimeout(() => orbitalAudio.playPeriapsisSweep(), 900);
    } else if (tour.status === TourStatus.CAPTURED) {
      orbitalAudio.stopPings();
      orbitalAudio.playCaptureCollapse();
      spaceScore.cue('capture');
    } else {
      orbitalAudio.stopPings();
      orbitalAudio.playSonicBoom();
      if (tour.status !== TourStatus.CRUISING) orbitalAudio.playEscapeSuccess();
      spaceScore.cue(tour.status === TourStatus.CRUISING ? 'survive' : tour.status === TourStatus.EJECTED ? 'bank' : 'complete');
    }
  }, [tour, sceneKey]);

  const pickBody = (body: BodyId) => {
    if (inTour) return;
    if (round?.revealed) reset();
    setSelected(body);
    if (plan[0] !== body) setPlan([]);
    orbitalAudio.playBlip(440 + rankOf(body) * 90);
  };
  const choosePreset = (route: BodyId[]) => {
    if (inTour) return;
    if (round?.revealed) reset();
    setPlan(route);
    setSelected(route[0]);
    orbitalAudio.playBlip(760);
  };
  const doLaunch = () => {
    if (inTour || launchBlocker || wager === null) return;
    void start(selected, wager);
  };
  const reFly = () => {
    if (inTour || !lastRoute.length || wager === null || launchBlocker) return;
    if (round?.revealed) reset();
    setPlan(lastRoute);
    setSelected(lastRoute[0]);
    void start(lastRoute[0], wager);
  };
  const rearm = () => {
    if (inTour) return;
    if (round?.revealed) reset();
    if (lastRoute.length && plan.join() !== lastRoute.join()) {
      setPlan(lastRoute);
      setSelected(lastRoute[0]);
    } else setPlan([]);
  };
  // Map click: while planning it chains another leg onto the plan; in flight it aims the next burn.
  const pickOnMap = (body: BodyId) => {
    if (inTour) {
      if (nextBodies.includes(body)) setTarget(body);
      return;
    }
    if (round?.revealed) reset();
    setSelected(mapBase[0]);
    setPlan([...mapBase, body]);
    orbitalAudio.playBlip(520 + rankOf(body) * 90);
  };
  const scaleWager = (factor: number) => {
    const current = Number(wagerInput) || 0;
    const next = Math.max(0.0001, current * factor);
    setWagerInput(String(Number(next.toFixed(4))));
  };

  // How the focused control got focus: a pointer press, or keyboard navigation (Tab).
  const focusFromPointer = useRef(false);
  useEffect(() => {
    const onPointer = () => {
      focusFromPointer.current = true;
    };
    const onTab = (e: KeyboardEvent) => {
      if (e.key === 'Tab') focusFromPointer.current = false;
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onTab, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onTab, true);
    };
  }, []);

  // Keyboard: 1-8 pick or aim a body (safest to wildest), E ejects, Space/Enter launches or burns, R re-arms.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (careerOpen || helpOpen)) {
        setCareerOpen(false);
        setHelpOpen(false);
        return;
      }
      // Never hijack keys meant for a control the player reached with Tab: Enter/Space must press that
      // button. A button that merely kept focus after a mouse click must not swallow the shortcuts,
      // or Space would re-press the preset instead of launching. (:focus-visible cannot tell these
      // apart: Chrome flips it on at the first keydown.)
      const el = e.target instanceof Element ? e.target : null;
      const typing = el?.closest('input, textarea, select, [contenteditable="true"]');
      const control = el?.closest('button, a[href], [role="button"]');
      if (typing || (control && !focusFromPointer.current) || helpOpen || careerOpen || titleOpen) return;
      const n = Number(e.key);
      const key = e.key.toLowerCase();
      if (n >= 1 && n <= BODY_ORDER.length) {
        const body = BODY_ORDER[n - 1];
        if (inTour) {
          if (nextBodies.includes(body)) setTarget(body);
        } else pickBody(body);
      } else if ((key === 'e' || key === 'b') && nextBodies.length > 0) void eject();
      else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!inTour) doLaunch();
        else if (burnTarget !== null) void launch(burnTarget);
      } else if (key === 'r') {
        // One key to fly the same route again, matching the RE-FLY button; otherwise re-arm the plan.
        if (round?.revealed && lastRoute.length && launchBlocker === null) reFly();
        else rearm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const outcome = round && (isTerminalTour(round.shown) || round.aborted) ? outcomeLine(round, fmt, symbol) : null;
  const toneClass = {
    gold: 'border-amber-300/70 bg-black/75 text-amber-200',
    red: 'border-red-400/70 bg-black/75 text-red-300',
    amber: 'border-amber-500/70 bg-black/75 text-amber-300',
  };

  return (
    <div className="relative flex flex-col bg-hull-950 text-hull-100 font-ui overflow-hidden" style={{ height: rootHeight }}>
      <header className="h-14 shrink-0 flex items-center justify-between gap-2 px-3 sm:px-5 border-b border-hull-800 bg-hull-900/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 rounded-lg bg-gradient-to-tr from-nebula-600 to-flare-500 flex items-center justify-center shadow-lg shadow-nebula-600/30">
            <Orbit className="w-5 h-5 text-hull-950" />
          </div>
          <div className="leading-tight min-w-0">
            <div className="text-[9px] tracking-[0.35em] text-flare-400 truncate">GRAVITY SLINGSHOT</div>
            <div className="font-display text-[11px] sm:text-base text-hull-100 whitespace-nowrap">GRAND TOUR</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-hull-850 border border-hull-700 text-[10px] tracking-widest text-hull-300">
            <span className={`w-1.5 h-1.5 rounded-full ${hostApi ? 'bg-mint-400' : 'bg-flare-400'}`} />
            {hostApi ? 'ON-CHAIN' : 'DEMO'}
          </div>
          {balance !== undefined && (
            <div className="flex items-baseline gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg bg-hull-850 border border-hull-700">
              <span className="hidden sm:inline text-[9px] tracking-widest text-hull-400">BALANCE</span>
              <span className="font-semibold tabular-nums text-sm">{fmt(balance)}</span>
              <span className="text-[10px] text-flare-300">{symbol}</span>
            </div>
          )}
          <IconButton
            title={musicOn ? 'Music on' : 'Music off'}
            active={musicOn}
            onClick={() => {
              setMusicOn(!musicOn);
              spaceScore.setEnabled(!musicOn);
            }}
          >
            <Music className="w-4 h-4" />
          </IconButton>
          <IconButton
            title={sfxOn ? 'Sound effects on' : 'Sound effects off'}
            active={sfxOn}
            onClick={() => {
              setSfxOn(!sfxOn);
              orbitalAudio.setMuted(sfxOn);
            }}
          >
            {sfxOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label="Volume"
            title="Volume"
            onChange={e => {
              const v = Number(e.target.value);
              setVolume(v);
              orbitalAudio.setVolume(v);
              spaceScore.setVolume(v);
            }}
            className="hidden md:block w-20 accent-orange-400"
          />
          <span className="hidden sm:inline-flex">
            <IconButton
              title={crtOn ? 'CRT display on' : 'CRT display off'}
              active={crtOn}
              onClick={() => {
                setCrtOn(!crtOn);
                writeFlag(CRT_KEY, !crtOn);
              }}
            >
              <Tv className="w-4 h-4" />
            </IconButton>
          </span>
          <button
            onClick={() => setCareerOpen(true)}
            title={`Pilot level ${pilotLevel.level}: ${pilotLevel.into} / ${pilotLevel.span} XP to the next level`}
            className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-hull-850 border border-hull-700 hover:border-hull-600"
          >
            <span className="font-display text-[11px] text-flare-300">LV {pilotLevel.level}</span>
            <span className="w-16 h-1.5 rounded-full bg-hull-800 overflow-hidden">
              <span className="block h-full bg-gradient-to-r from-nebula-500 to-flare-400 transition-all duration-700" style={{ width: `${pilotLevel.progress * 100}%` }} />
            </span>
            {career.dayStreak > 1 && (
              <span className="flex items-center gap-0.5 text-[10px] text-flare-300">
                <Flame className="w-3 h-3" />
                {career.dayStreak}d
              </span>
            )}
          </button>
          <IconButton title={`Pilot career: ${pilot.rank.name}`} onClick={() => setCareerOpen(true)}>
            <Award className="w-4 h-4" />
          </IconButton>
          <IconButton title="How to play" onClick={() => setHelpOpen(true)}>
            <HelpCircle className="w-4 h-4" />
          </IconButton>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* The game scene keeps its own colors. */}
        <section className="relative flex-1 min-w-0 h-[46vh] min-h-[320px] lg:h-auto lg:min-h-0 overflow-hidden bg-gray-950">
          <div className="absolute inset-0" style={crtOn ? { filter: `url(#${CRT_FILTER_ID})` } : undefined}>
          <TourCanvas scene={scene} />
          <div className="absolute top-4 left-4 text-[11px] pointer-events-none">
            <div className="rounded-xl bg-black/45 border border-cyan-300/15 backdrop-blur-[2px] px-2.5 py-2 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
              <div className="flex items-center justify-between gap-3 text-[10px] tracking-widest">
                <span className="text-gray-400">
                  LEG {tour && inTour ? Math.min(tour.legs, MAX_LEGS) : 0} / {MAX_LEGS}
                </span>
                <span className="text-cyan-300 truncate max-w-[130px]">{missionDesignation(missionRoute)}</span>
              </div>
              <div className={`mt-1 flex items-center gap-1.5 ${BODY_TONE[currentBody].text}`}>
                <BodyArt body={currentBody} size={16} />
                {BODIES[currentBody].name} {pct(BODIES[currentBody].surviveBps)} / {BODIES[currentBody].multLabel}
              </div>
              <div className="hidden md:block lg:hidden min-[1200px]:block mt-1">
                <FlightGauges velocityKms={tel.velocityKms} g={tel.g} />
              </div>
              <div className="hidden sm:block md:hidden lg:block min-[1200px]:hidden mt-1 space-y-0.5 text-[10px] text-gray-300 tabular-nums w-40">
                <div className="flex justify-between"><span className="text-gray-500">VELOCITY</span>{tel.velocity}</div>
                <div className="flex justify-between"><span className="text-gray-500">G-LOAD</span><span className={atPeriapsis ? 'text-amber-300' : ''}>{tel.gLoad}</span></div>
              </div>
              <div className="hidden sm:flex justify-between gap-3 text-[10px] tabular-nums"><span className="text-gray-500">PERIAPSIS</span><span className="text-gray-300">{tel.altitude}</span></div>
            </div>
          </div>
          <div className="absolute top-3 inset-x-0 flex flex-col items-end pr-4 sm:items-center sm:pr-0 pointer-events-none">
            <div className="text-[10px] tracking-[0.3em] text-gray-400">{round ? 'TOUR VALUE' : 'BEST TOUR'}</div>
            <div key={`v-${survived.length}-${round ? 1 : 0}`} className="font-display text-3xl sm:text-4xl text-emerald-300 drop-shadow-[0_0_18px_rgba(52,211,153,0.35)] animate-pop tabular-nums">
              {mult(shownValue)}
            </div>
            {round && survived.length > 0 && (
              <div className="text-xs text-amber-300 tabular-nums">
                bank {fmt(cashValue)} {symbol}
              </div>
            )}
            {career.winStreak >= 2 && (
              <div className="mt-1 flex items-center gap-1 rounded-full border border-flare-500/40 bg-black/40 px-2 py-0.5 text-[10px] tracking-widest text-flare-300">
                <Flame className="w-3 h-3" /> {career.winStreak} BANK STREAK
              </div>
            )}
          </div>
          {outcome && !win && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center pointer-events-none px-4">
              <div key={`o-${sceneKey}`} className={`px-5 py-3 rounded-xl border text-center animate-pop ${toneClass[outcome.tone as keyof typeof toneClass]}`}>
                <div className="font-display text-sm sm:text-base tracking-wider">{outcome.title}</div>
                <div className="text-xs opacity-90 mt-0.5">{outcome.body}</div>
                {round?.revealed && (
                  <div className="mt-1.5 text-[10px] tracking-widest opacity-70">
                    SPACE FLY AGAIN{lastRoute.length > 1 ? ' | R RE-FLY ROUTE' : ''}
                  </div>
                )}
              </div>
            </div>
          )}
          {tour?.status === TourStatus.BURNING && (
            <div className="absolute inset-x-0 bottom-24 text-center text-xs tracking-widest text-cyan-300 animate-pulse pointer-events-none">
              PERIAPSIS PASS: VRF RESOLVING
            </div>
          )}
          <Trajectory tour={inTour || round ? tour : null} />
          </div>
          <CrtLayer on={crtOn} />
        </section>

        <aside className="lg:w-[380px] shrink-0 flex flex-col min-h-0 border-t lg:border-t-0 lg:border-l border-hull-700 bg-hull-900/95">
          <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-3">
            {error && (
              <div className="flex items-start justify-between gap-2 p-2.5 rounded-lg border border-ember-400/40 bg-ember-400/10 text-ember-300 text-xs">
                <span className="flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
                </span>
                <button onClick={clearError} className="hover:text-hull-100">
                  dismiss
                </button>
              </div>
            )}

            {inTour && round && tour ? (
              round.busy === 'opening' || tour.status === TourStatus.BURNING ? (
                <div className="rounded-xl border border-hull-700 bg-hull-850 p-4 flex flex-col items-center text-center">
                  <div className="text-[11px] tracking-[0.3em] text-nebula-300">LEG {tour.legs} OF {MAX_LEGS}</div>
                  <BodyArt body={currentBody} size={96} className="my-2" />
                  <div className="font-display text-sm">{round.busy === 'opening' ? 'CONFIRM IN WALLET' : `SLINGSHOT: ${BODIES[currentBody].name.toUpperCase()}`}</div>
                  <div className="text-xs text-hull-400 mt-1">{pct(BODIES[currentBody].surviveBps)} chance to survive this assist</div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-cyan-300">
                    <Rocket className="w-4 h-4 animate-bounce text-flare-400" /> Waiting for Chain VRF
                  </div>
                </div>
              ) : tour.status === TourStatus.CRUISING ? (
                <>
                  <div className="flex items-center gap-2 text-mint-300 text-sm font-semibold">
                    <CheckCircle2 className="w-4 h-4" /> ASSIST {survived.length} SURVIVED
                  </div>
                  <button
                    onClick={() => void eject()}
                    disabled={round.busy !== null}
                    className="w-full py-3.5 rounded-xl font-display text-sm tracking-wider bg-gradient-to-r from-flare-500 to-flare-300 text-hull-950 hover:brightness-110 disabled:opacity-50 shadow-lg shadow-flare-500/25 flex flex-col items-center"
                  >
                    <span>{round.busy === 'eject' ? 'EJECTING...' : 'EJECT AND BANK'}</span>
                    <span className="font-ui text-lg font-bold tabular-nums">
                      {fmt(cashValue)} {symbol} <Kbd>E</Kbd>
                    </span>
                  </button>
                  <div className="text-[11px] tracking-widest text-hull-400">
                    OR BURN ONWARD {tour.legs < MAX_LEGS ? `| LEG ${tour.legs + 1} OF ${MAX_LEGS}` : ''}
                  </div>
                  {burnTarget !== null && (
                    <button
                      onClick={() => void launch(burnTarget)}
                      disabled={round.busy !== null}
                      className="w-full py-2 rounded-xl border border-nebula-400/60 bg-nebula-500/10 text-nebula-300 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-nebula-500/20"
                    >
                      BURN TO {BODIES[burnTarget].name.toUpperCase()} {mult(paidMultiplier([...survived, burnTarget]))} <Kbd>SPACE</Kbd>
                    </button>
                  )}
                  {tour.legs < MAX_LEGS && (
                    <SystemMap
                      base={mapBase}
                      legal={mapLegal}
                      hovered={hovered}
                      onHover={setHovered}
                      onPick={pickOnMap}
                      title="NEXT ASSIST"
                      hint="click to aim, SPACE to burn"
                    />
                  )}
                  <div className="grid grid-cols-4 gap-1.5">
                    {BODY_ORDER.map(id => {
                      const allowed = nextBodies.includes(id);
                      return (
                        <BodyCard
                          key={id}
                          body={id}
                          selected={burnTarget === id}
                          onHover={h => setHovered(h ? id : null)}
                          disabled={!allowed || round.busy !== null}
                          onClick={() => void launch(id)}
                          pays={allowed ? mult(routeMultiplier([...survived, id])) : BODIES[id].multLabel}
                          note={allowed ? `bank ${fmt(tourPayout(round.wager, [...survived, id]))}` : 'just left it'}
                        />
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-hull-700 bg-hull-850 p-6 text-center text-sm text-hull-400">Settling on-chain...</div>
              )
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] tracking-[0.3em] text-hull-400">FLIGHT PLAN</div>
                  <div className="text-[10px] text-hull-600">pick your first assist</div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  {ROUTE_PRESETS.map(preset => (
                    <button
                      key={preset.name}
                      onClick={() => choosePreset(preset.route)}
                      className={`rounded-lg border px-2 py-1.5 text-left ${
                        plan.join() === preset.route.join() ? 'border-flare-400 bg-flare-500/10' : 'border-hull-700 bg-hull-850 hover:border-hull-600'
                      }`}
                    >
                      <div className="text-[11px] font-semibold truncate">{preset.name}</div>
                      <div className="text-[9px] text-hull-400 truncate">{presetSummary(preset.route)}</div>
                    </button>
                  ))}
                </div>
                {plan.length > 1 && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-hull-700 bg-hull-850 px-2 py-1.5 text-[11px]">
                    <span className="text-hull-400">PLAN</span>
                    {plan.map((b, i) => (
                      <BodyArt key={i} body={b} size={20} />
                    ))}
                    <span className="ml-auto text-mint-300 tabular-nums">{mult(paidMultiplier(plan))}</span>
                    <button onClick={() => setPlan([])} aria-label="Clear plan" className="text-hull-400 hover:text-hull-100">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <SystemMap
                  base={mapBase}
                  legal={mapLegal}
                  hovered={hovered}
                  onHover={setHovered}
                  onPick={pickOnMap}
                  title="GALAXY MAP"
                  hint={mapLegal.length ? 'click worlds to chain legs' : 'four legs planned'}
                />
                <div className="grid grid-cols-4 gap-1.5">
                  {BODY_ORDER.map(id => (
                    <BodyCard key={id} body={id} selected={selected === id} onClick={() => pickBody(id)} onHover={h => setHovered(h ? id : null)} pays={`${BODIES[id].multLabel}`} />
                  ))}
                </div>
                <div className="rounded-xl border border-hull-700 bg-hull-850 p-3">
                  <div className="flex items-center justify-between text-[11px] tracking-widest text-hull-400">
                    <span>WAGER</span>
                    {maxWager !== undefined && <span className="tracking-normal">max {fmt(maxWager)}</span>}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button onClick={() => scaleWager(0.5)} className="w-10 h-10 rounded-lg bg-hull-800 border border-hull-700 text-xs text-hull-300 hover:text-hull-100">
                      1/2
                    </button>
                    <div className="relative flex-1">
                      <input
                        value={wagerInput}
                        onChange={e => setWagerInput(e.target.value)}
                        inputMode="decimal"
                        aria-label="Wager"
                        className="w-full h-10 bg-hull-950 border border-hull-700 rounded-lg pl-3 pr-14 text-sm font-semibold tabular-nums text-hull-100 focus:outline-none focus:border-flare-400"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-flare-300">{symbol}</span>
                    </div>
                    <button onClick={() => scaleWager(2)} className="w-10 h-10 rounded-lg bg-hull-800 border border-hull-700 text-xs text-hull-300 hover:text-hull-100">
                      2x
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-5 gap-1.5">
                    {WAGER_PRESETS.map(v => (
                      <button
                        key={v}
                        onClick={() => setWagerInput(v)}
                        className={`py-1 rounded text-xs border tabular-nums ${
                          wagerInput === v ? 'bg-flare-500/15 border-flare-400 text-flare-200' : 'bg-hull-800 border-hull-700 text-hull-300 hover:text-hull-100'
                        }`}
                      >
                        {v}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        const cap = maxWager !== undefined && balance !== undefined ? (balance < maxWager ? balance : maxWager) : (maxWager ?? balance);
                        if (cap !== undefined) setWagerInput(formatUnits(cap, decimals));
                      }}
                      className="py-1 rounded text-xs border bg-hull-800 border-hull-700 text-hull-300 hover:text-hull-100"
                    >
                      MAX
                    </button>
                  </div>
                  <div className="mt-2 text-[11px] text-hull-400">
                    Best tour from {BODIES[selected].name}: <span className="text-mint-300">{mult(maxPayoutMultiplier(selected))}</span>
                  </div>
                </div>
                {round?.revealed && lastRoute.length > 0 && (
                  <button
                    onClick={reFly}
                    disabled={launchBlocker !== null}
                    className="w-full py-2.5 rounded-xl border border-flare-400/60 bg-flare-500/10 text-flare-200 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-flare-500/20 disabled:opacity-40"
                  >
                    <RotateCcw className="w-4 h-4" /> RE-FLY LAST ROUTE
                    <span className="flex gap-0.5">
                      {lastRoute.map((b, i) => (
                        <BodyArt key={i} body={b} size={16} />
                      ))}
                    </span>
                    <Kbd>R</Kbd>
                  </button>
                )}
                {demoDry && (
                  <button
                    onClick={() => {
                      refuelDemo();
                      orbitalAudio.playBlip(660);
                    }}
                    className="w-full py-2.5 rounded-xl border border-mint-400/60 bg-mint-400/10 text-mint-300 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-mint-400/20"
                  >
                    <Fuel className="w-4 h-4" /> REFUEL PRACTICE BALANCE TO 100 DEMO
                  </button>
                )}
                <button
                  onClick={doLaunch}
                  disabled={launchBlocker !== null}
                  className={`relative overflow-hidden w-full py-4 rounded-xl font-display text-sm tracking-wider flex items-center justify-center gap-2 bg-gradient-to-r from-nebula-500 to-flare-500 hover:brightness-110 text-white shadow-lg shadow-nebula-500/30 disabled:opacity-40 disabled:cursor-not-allowed ${launchBlocker ? '' : 'btn-shimmer'}`}
                >
                  <Rocket className="w-5 h-5" />
                  {launchBlocker ?? `LAUNCH TO ${BODIES[selected].name.toUpperCase()}`}
                  {!launchBlocker && <Kbd>SPACE</Kbd>}
                </button>
              </>
            )}

            <MissionsPanel board={board} />
            <FlightLog history={history} fmt={fmt} symbol={symbol} />
            <Blackbox tour={round ? tour : null} words={vrfWords} demo={!hostApi} onVerify={verifyVrf} />
            <p className="text-[10px] leading-relaxed text-hull-600">
              Every route returns 93% on average, so your route only sets the risk. Top route: Pulsar, Black hole, Pulsar, Black hole for {mult(TOP_PAYOUT)} (1 in 1024).
            </p>
          </div>
        </aside>
      </div>

      <TitleScreen
        open={titleOpen}
        onBegin={() => {
          setTitleOpen(false);
          spaceScore.start();
        }}
        rankName={pilot.rank.name}
        tours={career.tours}
        level={pilotLevel.level}
        dayStreak={career.dayStreak}
        missionsLeft={board.missions.filter(m => !m.done).length}
        worldsCharted={career.discovered.length}
      />
      <HowToPlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <CareerModal open={careerOpen} onClose={() => setCareerOpen(false)} career={career} />
      <WinCelebration win={win} onDone={clearWin} />
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
        {toasts.map(t => {
          const { box, Icon } = TOAST_STYLE[t.tone];
          return (
            <div key={t.id} className={`px-4 py-2 rounded-xl border bg-hull-900/95 text-sm font-semibold shadow-lg animate-pop flex items-center gap-2 whitespace-nowrap ${box}`}>
              <Icon className="w-4 h-4" /> {t.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
