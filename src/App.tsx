import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatUnits, parseUnits } from 'viem';
import { computeMaxWager } from '@chain/casino-sdk/guest';
import { useCasinoHost } from './lib/useCasinoHost';
import { useGrandTour, isTerminalTour, type HistoryEntry, type Round } from './lib/useGrandTour';
import {
  BODIES,
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
import { orbitalAudio } from './audio/orbitalAudio';
import { AlertTriangle, CheckCircle2, History, Orbit, Rocket, Shield, Sparkles, Volume2, VolumeX } from 'lucide-react';

const BODY_STYLE: Record<BodyId, { dot: string; ring: string; text: string }> = {
  0: { dot: 'from-slate-200 to-slate-500', ring: 'border-slate-400/60 bg-slate-400/10', text: 'text-slate-200' },
  1: { dot: 'from-amber-200 to-orange-600', ring: 'border-amber-400/60 bg-amber-400/10', text: 'text-amber-300' },
  2: { dot: 'from-white to-sky-500', ring: 'border-sky-400/60 bg-sky-400/10', text: 'text-sky-300' },
  3: { dot: 'from-black via-black to-flare-500', ring: 'border-nebula-400/60 bg-nebula-500/10', text: 'text-nebula-300' },
};
const WAGER_PRESETS = ['0.01', '0.1', '1', '10'];
const TOP_PAYOUT = maxPayoutMultiplier(2);

const pct = (bps: number) => `${bps / 100}%`;
const mult = (x: number) => `x${x.toFixed(2)}`;

function useAmountFormatter(decimals: number) {
  return (value: bigint) => {
    const n = Number(formatUnits(value, decimals));
    return n >= 1000 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(4);
  };
}

function canvasPhase(tour: Tour): CanvasPhase {
  if (tour.status === TourStatus.BURNING) return 'burning';
  if (tour.status === TourStatus.CRUISING) return 'survived';
  if (tour.status === TourStatus.CAPTURED) return 'captured';
  if (tour.status === TourStatus.EJECTED) return 'ejected';
  return 'complete';
}

function BodyDot({ body, size = 'w-4 h-4' }: { body: BodyId; size?: string }) {
  const ring = body === 3 ? ' ring-1 ring-flare-400/70' : '';
  return <span className={`inline-block rounded-full bg-gradient-to-br ${BODY_STYLE[body].dot} ${size} shrink-0${ring}`} />;
}

function RouteStrip({ tour }: { tour: Tour | null }) {
  const flown = tour ? flownRoute(tour) : [];
  let running = 1;
  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: MAX_LEGS }, (_, leg) => {
        const body = flown[leg] as BodyId | undefined;
        const inFlight = tour !== null && leg === tour.legs - 1 && tour.status === TourStatus.BURNING;
        const lost = tour !== null && leg === tour.legs - 1 && tour.status === TourStatus.CAPTURED;
        const survived = body !== undefined && !inFlight && !lost;
        if (survived) running *= routeMultiplier([body]);
        const roll = tour?.rolls[leg];
        return (
          <div
            key={leg}
            title={body !== undefined && !inFlight ? `roll ${roll} vs gate < ${BODIES[body].surviveBps}` : undefined}
            className={`rounded-lg border px-2 py-2 text-center font-mono transition-all ${
              body === undefined
                ? 'border-dashed border-hull-700 text-hull-600'
                : lost
                  ? 'border-ember-400/60 bg-ember-400/10 text-ember-300'
                  : inFlight
                    ? 'border-nebula-400/70 bg-nebula-500/10 text-nebula-300 animate-pulse'
                    : 'border-mint-400/50 bg-mint-400/10 text-mint-300'
            }`}
          >
            <div className="text-[10px] text-hull-400">LEG {leg + 1}</div>
            {body === undefined ? (
              <div className="text-sm py-0.5">?</div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold py-0.5 truncate">
                <BodyDot body={body} size="w-3 h-3" />
                {BODIES[body].name}
              </div>
            )}
            <div className="text-[10px]">
              {survived ? mult(running) : lost ? 'CAPTURED' : inFlight ? `${pct(BODIES[body!].surviveBps)} to survive` : '--'}
            </div>
          </div>
        );
      })}
    </div>
  );
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

export default function App() {
  const { hostApi, snapshot } = useCasinoHost();
  const { round, sceneKey, error, clearError, start, launch, eject, reset, history, demoBalance } = useGrandTour(hostApi, snapshot);
  const [selected, setSelected] = useState<BodyId>(1);
  const [wagerInput, setWagerInput] = useState('1');
  const [muted, setMuted] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const decimals = snapshot?.token.decimals ?? 18;
  const symbol = hostApi ? (snapshot?.token.symbol ?? '') : 'DEMO';
  const fmt = useAmountFormatter(decimals);
  const balance = hostApi
    ? snapshot?.balances.smartVaultBalance !== undefined
      ? BigInt(snapshot.balances.smartVaultBalance)
      : undefined
    : demoBalance;
  const walletReady = !hostApi || snapshot?.wallet.status === 'ready';

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

  const launchBlocker = !walletReady
    ? 'Connect your wallet in the host'
    : wager === null
      ? 'Enter a wager'
      : balance !== undefined && wager > balance
        ? 'Wager exceeds balance'
        : maxWager !== undefined && wager > maxWager
          ? `Max bet for this route is ${fmt(maxWager)} ${symbol}`
          : null;

  const scene: CanvasScene = useMemo(() => {
    if (!round || !tour) return { key: sceneKey, phase: 'idle', body: selected };
    return { key: sceneKey, phase: canvasPhase(tour), body: tour.route[tour.legs - 1] as BodyId };
  }, [round, tour, sceneKey, selected]);

  // Audio cues follow what the player sees, not raw chain events.
  const lastCue = useRef('');
  useEffect(() => {
    if (!tour) return;
    const cue = `${sceneKey}:${tour.status}:${tour.legs}`;
    if (cue === lastCue.current) return;
    lastCue.current = cue;
    if (tour.status === TourStatus.BURNING) {
      orbitalAudio.playGravityWellHum();
      setTimeout(() => orbitalAudio.playPeriapsisSweep(), 900);
    } else if (tour.status === TourStatus.CAPTURED) orbitalAudio.playCaptureFailure();
    else orbitalAudio.playEscapeSuccess();
  }, [tour, sceneKey]);

  const pickBody = (body: BodyId) => {
    if (inTour) return;
    if (round?.revealed) reset();
    setSelected(body);
    orbitalAudio.playBlip(500 + body * 180);
  };
  const doLaunch = () => {
    if (inTour || launchBlocker || wager === null) return;
    void start(selected, wager);
  };

  // Keyboard: 1-4 pick or burn a body, E ejects, Enter launches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= BODIES.length) {
        const body = (n - 1) as BodyId;
        if (inTour) {
          if (nextBodies.includes(body)) void launch(body);
        } else pickBody(body);
      } else if (e.key.toLowerCase() === 'e' && nextBodies.length > 0) void eject();
      else if (e.key === 'Enter' && !inTour) doLaunch();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const outcome = round && (isTerminalTour(round.shown) || round.aborted) ? outcomeLine(round, fmt, symbol) : null;
  const toneClass = {
    gold: 'border-flare-400/60 bg-hull-950/80 text-flare-200',
    red: 'border-ember-400/60 bg-hull-950/80 text-ember-300',
    amber: 'border-flare-600/60 bg-hull-950/80 text-flare-300',
  };

  return (
    <div className="min-h-screen bg-hull-950 text-hull-100 flex flex-col font-sans">
      <header className="border-b border-hull-800 bg-hull-900/70 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-nebula-600 to-flare-500 flex items-center justify-center border border-flare-400/40 shadow-lg shadow-nebula-600/30">
              <Orbit className="w-6 h-6 text-hull-950" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-wider text-hull-100">
                GRAVITY SLINGSHOT <span className="text-flare-400">GRAND TOUR</span>
              </h1>
              <p className="text-xs text-hull-400 font-mono">Four gravity assists. Bank any time. 98.00% RTP on every route.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setMuted(!muted);
                orbitalAudio.setMuted(!muted);
              }}
              className="p-2 rounded-lg bg-hull-800 hover:bg-hull-700 border border-hull-700"
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <VolumeX className="w-4 h-4 text-ember-400" /> : <Volume2 className="w-4 h-4 text-flare-300" />}
            </button>
            <button
              onClick={() => setShowRules(!showRules)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-hull-800 hover:bg-hull-700 text-xs font-mono text-hull-300 border border-hull-700"
            >
              <Shield className="w-3.5 h-3.5 text-mint-400" /> How it pays
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-hull-900 border border-hull-700 text-xs font-mono text-hull-300">
              <span className={`w-2 h-2 rounded-full ${hostApi ? 'bg-mint-400' : 'bg-flare-400'}`} />
              {hostApi ? 'ON-CHAIN' : 'DEMO MODE'}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pt-5 pb-16 flex-1 flex flex-col gap-5 w-full">
        {showRules && (
          <section className="p-4 rounded-xl bg-hull-900/90 border border-nebula-500/30 text-sm text-hull-300 grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <h2 className="font-bold text-nebula-300">The Grand Tour</h2>
              <p>Pick a body and launch. Survive the slingshot and your tour value multiplies. Then eject to bank it, or burn on to a new body. You get up to four assists, and you can never slingshot the body you just left.</p>
              <p>Every leg draws fresh on-chain VRF randomness. Rolls use rejection sampling, so there is no modulo bias.</p>
            </div>
            <div className="space-y-2">
              <h2 className="font-bold text-flare-300">Why it is always 98%</h2>
              <p className="font-mono text-xs bg-hull-950/70 rounded p-2 border border-hull-700 text-hull-300">
                Moon 80% x 1.25 = Jupiter 50% x 2 = Pulsar 25% x 4 = Black hole 12.5% x 8 = 1.00
                <br />
                payout = wager x (leg multipliers) x 0.98
              </p>
              <p>Every leg is a fair bet, and the 2% edge is taken once, when you bank. Whatever route you fly and whenever you eject, your expected return is exactly 98.00%. Your choices change the swing, never the edge. The contract tests check all 160 possible strategies with exact integer math.</p>
            </div>
          </section>
        )}

        {error && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-ember-400/40 bg-ember-400/10 text-ember-300 text-xs font-mono">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </span>
            <button onClick={clearError} className="text-ember-300 hover:text-hull-100">
              dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Stage: the game view keeps its own colors */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="relative h-[300px] sm:h-[380px] rounded-xl overflow-hidden border border-hull-700 bg-gray-950 shadow-2xl shadow-nebula-600/10">
              <TourCanvas scene={scene} />
              <div className="absolute top-3 left-3 font-mono text-xs space-y-1 pointer-events-none">
                <div className="text-gray-400">
                  LEG {tour ? Math.min(tour.legs, MAX_LEGS) : 0} / {MAX_LEGS}
                </div>
                {tour && (
                  <div className={`flex items-center gap-1.5 ${BODY_STYLE[tour.route[tour.legs - 1] as BodyId].text}`}>
                    <BodyDot body={tour.route[tour.legs - 1] as BodyId} size="w-3 h-3" />
                    {BODIES[tour.route[tour.legs - 1]].name} {pct(BODIES[tour.route[tour.legs - 1]].surviveBps)} / {BODIES[tour.route[tour.legs - 1]].multLabel}
                  </div>
                )}
              </div>
              <div className="absolute top-3 right-3 text-right font-mono pointer-events-none">
                <div className="text-[10px] text-gray-400">TOUR VALUE</div>
                <div key={`v-${survived.length}`} className="text-3xl font-black text-emerald-300 animate-pop">
                  {mult(routeMultiplier(survived))}
                </div>
                {round && survived.length > 0 && (
                  <div className="text-[11px] text-amber-300">
                    bank {fmt(cashValue)} {symbol}
                  </div>
                )}
              </div>
              {outcome && (
                <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
                  <div key={`o-${sceneKey}`} className={`px-4 py-2 rounded-lg border font-mono text-center animate-pop ${toneClass[outcome.tone as keyof typeof toneClass]}`}>
                    <div className="text-sm font-black tracking-wider">{outcome.title}</div>
                    <div className="text-xs opacity-90">{outcome.body}</div>
                  </div>
                </div>
              )}
              {tour?.status === TourStatus.BURNING && (
                <div className="absolute inset-x-0 bottom-4 text-center font-mono text-xs text-cyan-300 animate-pulse pointer-events-none">
                  PERIAPSIS PASS: VRF RESOLVING
                </div>
              )}
            </div>
            <RouteStrip tour={tour} />
          </div>

          {/* Flight computer */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {inTour && round && tour ? (
              <div className="p-4 rounded-xl bg-hull-900 border border-hull-700 flex flex-col gap-3">
                {round.busy === 'opening' || tour.status === TourStatus.BURNING ? (
                  <div className="py-6 text-center font-mono text-sm text-nebula-300">
                    <Rocket className="w-6 h-6 mx-auto mb-2 animate-bounce text-flare-400" />
                    {round.busy === 'opening' ? 'Confirm the launch in your wallet...' : `Slingshotting around ${BODIES[tour.route[tour.legs - 1]].name}...`}
                    <div className="text-xs text-hull-400 mt-1">{pct(BODIES[tour.route[tour.legs - 1]].surviveBps)} chance to survive this assist</div>
                  </div>
                ) : tour.status === TourStatus.CRUISING ? (
                  <>
                    <div className="flex items-center gap-2 text-mint-300 font-mono text-sm">
                      <CheckCircle2 className="w-4 h-4" /> Assist {survived.length} survived. Tour value {mult(routeMultiplier(survived))}
                    </div>
                    <button
                      onClick={() => void eject()}
                      disabled={round.busy !== null}
                      className="w-full py-3 rounded-xl font-black font-mono tracking-wider bg-gradient-to-r from-flare-500 to-flare-300 text-hull-950 hover:brightness-110 disabled:opacity-50 shadow-lg shadow-flare-500/20"
                    >
                      {round.busy === 'eject' ? 'EJECTING...' : `EJECT: BANK ${fmt(cashValue)} ${symbol}`}
                      <span className="block text-[10px] font-normal opacity-70">press E</span>
                    </button>
                    <div className="text-xs font-mono text-hull-400 uppercase">
                      or burn onward {tour.legs < MAX_LEGS ? `(leg ${tour.legs + 1} of ${MAX_LEGS})` : ''}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {BODIES.map(b => {
                        const allowed = nextBodies.includes(b.id);
                        const nextValue = tourPayout(round.wager, [...survived, b.id]);
                        return (
                          <button
                            key={b.id}
                            disabled={!allowed || round.busy !== null}
                            onClick={() => void launch(b.id)}
                            className={`rounded-lg border p-2 text-left font-mono transition-all ${
                              allowed ? `${BODY_STYLE[b.id].ring} hover:scale-[1.03]` : 'border-hull-800 opacity-40 cursor-not-allowed'
                            }`}
                          >
                            <div className={`flex items-center gap-1.5 text-xs font-bold ${BODY_STYLE[b.id].text}`}>
                              <BodyDot body={b.id} size="w-3 h-3" /> {b.name}
                              <span className="ml-auto text-[9px] font-normal text-hull-600">{b.id + 1}</span>
                            </div>
                            {allowed ? (
                              <div className="flex items-baseline justify-between mt-1">
                                <span className="text-[10px] text-hull-400">
                                  {pct(b.surviveBps)} / {b.multLabel}
                                </span>
                                <span className="text-[11px] text-mint-300">{mult(routeMultiplier([...survived, b.id]))}</span>
                              </div>
                            ) : (
                              <div className="text-[10px] text-hull-400 mt-1">just left it</div>
                            )}
                            {allowed && <div className="text-[10px] text-hull-400">bank {fmt(nextValue)}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="py-6 text-center font-mono text-sm text-hull-400">Settling on-chain...</div>
                )}
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-hull-900 border border-hull-700 flex flex-col gap-3">
                <div className="text-xs font-mono text-hull-400 uppercase">First assist</div>
                <div className="grid grid-cols-2 gap-2">
                  {BODIES.map(b => (
                    <button
                      key={b.id}
                      onClick={() => pickBody(b.id)}
                      className={`rounded-lg border p-2.5 text-left font-mono transition-all ${
                        selected === b.id ? `${BODY_STYLE[b.id].ring} ring-1 ring-flare-400/40` : 'border-hull-700 hover:border-hull-600 bg-hull-850'
                      }`}
                    >
                      <div className={`flex items-center gap-1.5 text-sm font-bold ${BODY_STYLE[b.id].text}`}>
                        <BodyDot body={b.id} /> {b.name}
                        <span className="ml-auto text-[9px] font-normal text-hull-600">{b.id + 1}</span>
                      </div>
                      <div className="text-[11px] text-hull-400 mt-1">{pct(b.surviveBps)} survive</div>
                      <div className="text-[11px] text-mint-300">{b.multLabel} per assist</div>
                    </button>
                  ))}
                </div>
                <div className="text-[11px] font-mono text-hull-400">
                  Best possible tour from {BODIES[selected].name}: {mult(maxPayoutMultiplier(selected))} paid.
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-hull-400 uppercase">Wager {symbol}</span>
                  {balance !== undefined && (
                    <span className="text-hull-400">
                      balance {fmt(balance)} {symbol}
                    </span>
                  )}
                </div>
                <input
                  value={wagerInput}
                  onChange={e => setWagerInput(e.target.value)}
                  inputMode="decimal"
                  className="w-full bg-hull-950 border border-hull-700 rounded-lg px-3 py-2 text-sm font-mono text-hull-100 focus:outline-none focus:border-flare-400"
                />
                <div className="flex flex-wrap gap-1.5">
                  {WAGER_PRESETS.map(v => (
                    <button
                      key={v}
                      onClick={() => setWagerInput(v)}
                      className={`px-2.5 py-1 rounded text-xs font-mono border ${
                        wagerInput === v ? 'bg-flare-500/15 border-flare-400 text-flare-200' : 'bg-hull-800 border-hull-700 text-hull-300 hover:text-hull-100'
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                  {maxWager !== undefined && (
                    <button
                      onClick={() => setWagerInput(formatUnits(balance !== undefined && balance < maxWager ? balance : maxWager, decimals))}
                      className="px-2.5 py-1 rounded text-xs font-mono border bg-hull-800 border-hull-700 text-hull-300 hover:text-hull-100"
                    >
                      MAX
                    </button>
                  )}
                </div>

                <button
                  onClick={doLaunch}
                  disabled={launchBlocker !== null}
                  className="w-full py-3.5 rounded-xl font-black font-mono tracking-wider flex items-center justify-center gap-2 bg-gradient-to-r from-nebula-500 to-flare-500 hover:brightness-110 text-white shadow-lg shadow-nebula-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Rocket className="w-5 h-5" />
                  {launchBlocker ?? `LAUNCH TO ${BODIES[selected].name.toUpperCase()}`}
                </button>
                {round?.revealed && (
                  <div className="text-[11px] text-center font-mono text-hull-400">Last tour logged below. Pick a body to plan the next one.</div>
                )}
              </div>
            )}

            <div className="p-3 rounded-xl bg-hull-900/60 border border-hull-700 text-[11px] font-mono text-hull-300 flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-flare-300 shrink-0" />
              <span>
                Every route returns 98% on average, so route choice only sets your risk. Zig-zag the Moon for steady wins, or fly Pulsar, Black hole, Pulsar, Black hole for {mult(TOP_PAYOUT)} (1 in 1024).
              </span>
            </div>
          </div>
        </div>

        <HistoryTable history={history} fmt={fmt} symbol={symbol} />
      </main>

      <footer className="border-t border-hull-800 py-4 text-center text-xs font-mono text-hull-400">
        Chain Jam Vol. 1 | ICasinoGameV2 multi-step session | Chain VRF per leg | 98.00% RTP on every strategy
      </footer>
    </div>
  );
}

function HistoryTable({ history, fmt, symbol }: { history: HistoryEntry[]; fmt: (v: bigint) => string; symbol: string }) {
  const label = (h: HistoryEntry) =>
    h.status === TourStatus.COMPLETE ? 'GRAND TOUR' : h.status === TourStatus.EJECTED ? 'BANKED' : h.status === TourStatus.CAPTURED ? 'CAPTURED' : 'ENDED';
  return (
    <section className="p-4 rounded-xl bg-hull-900 border border-hull-700">
      <div className="flex items-center gap-2 text-xs font-mono text-hull-400 mb-2">
        <History className="w-4 h-4 text-nebula-300" /> FLIGHT LOG
      </div>
      {history.length === 0 ? (
        <div className="py-4 text-center text-xs text-hull-400 font-mono">No tours flown yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-hull-700 text-hull-400">
                <th className="py-2 px-2">ROUTE</th>
                <th className="py-2 px-2">RESULT</th>
                <th className="py-2 px-2 text-right">WAGER</th>
                <th className="py-2 px-2 text-right">PAYOUT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hull-800">
              {history.map(h => (
                <tr key={h.key}>
                  <td className="py-2 px-2">
                    <span className="flex items-center gap-1">
                      {h.route.map((b, i) => (
                        <BodyDot key={i} body={b} size="w-3 h-3" />
                      ))}
                    </span>
                  </td>
                  <td className={`py-2 px-2 font-bold ${h.payout > 0n ? 'text-mint-400' : 'text-ember-400'}`}>{label(h)}</td>
                  <td className="py-2 px-2 text-right text-hull-400">
                    {fmt(h.wager)} {symbol}
                  </td>
                  <td className="py-2 px-2 text-right text-hull-100">
                    {fmt(h.payout)} {symbol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
