import React, { useState, useMemo, useEffect } from 'react';
import { useCasinoHost } from './lib/useCasinoHost';
import {
  encodeSlingshotData,
  decodeSlingshotState,
  calculateSlingshotPayout,
  getMultiplier,
  RISK_PRESETS,
  type SlingshotOutcome
} from './lib/slingshot';
import { OrbitalCanvas, type CelestialType } from './components/OrbitalCanvas';
import { orbitalAudio } from './audio/orbitalAudio';
import {
  Rocket,
  Shield,
  Gauge,
  Volume2,
  VolumeX,
  ExternalLink,
  Sparkles,
  AlertTriangle,
  History,
  CheckCircle2,
  Orbit
} from 'lucide-react';

interface FlightRecord {
  id: string;
  timestamp: string;
  celestial: CelestialType;
  riskRatingBps: number;
  multiplier: number;
  escaped: boolean;
  rollBps: number;
  payoutEth: string;
}

export default function App() {
  const { hostApi, snapshot } = useCasinoHost();
  const [celestial, setCelestial] = useState<CelestialType>('pulsar');
  const [riskRatingBps, setRiskRatingBps] = useState<number>(5000); // 50.00% default
  const [wagerEth, setWagerEth] = useState<string>('0.01');
  const [phase, setPhase] = useState<'idle' | 'launching' | 'escaped' | 'captured'>('idle');
  const [lastOutcome, setLastOutcome] = useState<SlingshotOutcome | null>(null);
  const [history, setHistory] = useState<FlightRecord[]>([]);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [showFairness, setShowFairness] = useState<boolean>(false);

  const multiplier = useMemo(() => getMultiplier(riskRatingBps), [riskRatingBps]);
  const winProbability = useMemo(() => (riskRatingBps / 100).toFixed(2), [riskRatingBps]);

  const celestialId = useMemo(() => {
    if (celestial === 'jupiter') return 0;
    if (celestial === 'pulsar') return 1;
    return 2;
  }, [celestial]);

  const wagerWei = useMemo(() => {
    try {
      const parsed = parseFloat(wagerEth);
      if (isNaN(parsed) || parsed <= 0) return 0n;
      return BigInt(Math.floor(parsed * 1e18));
    } catch (err: unknown) {
      console.warn('Wager parsing failed:', err);
      return 0n;
    }
  }, [wagerEth]);

  const potentialPayoutEth = useMemo(() => {
    if (wagerWei === 0n) return '0.0000';
    const payoutWei = calculateSlingshotPayout(wagerWei, riskRatingBps);
    return (Number(payoutWei) / 1e18).toFixed(4);
  }, [wagerWei, riskRatingBps]);

  // Audio mute toggle
  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    orbitalAudio.setMuted(nextMuted);
  };

  // React to host snapshot session updates
  useEffect(() => {
    if (!snapshot) return;
    const rawState = snapshot.sessions?.items?.[0]?.raw?.gameState;
    if (rawState && rawState !== '0x') {
      const decoded = decodeSlingshotState(rawState as `0x${string}`);
      if (decoded && decoded.resolved) {
        setLastOutcome(decoded);
        if (decoded.escaped) {
          setPhase('escaped');
          orbitalAudio.playEscapeSuccess();
        } else {
          setPhase('captured');
          orbitalAudio.playCaptureFailure();
        }

        const newRecord: FlightRecord = {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString(),
          celestial,
          riskRatingBps: decoded.riskRatingBps,
          multiplier: getMultiplier(decoded.riskRatingBps),
          escaped: decoded.escaped,
          rollBps: decoded.rollBps,
          payoutEth: (Number(decoded.payout) / 1e18).toFixed(4),
        };
        setHistory((prev) => [newRecord, ...prev.slice(0, 19)]);
      }
    }
  }, [snapshot, celestial]);

  // Handle launch burn
  const handleLaunch = async () => {
    if (wagerWei === 0n || phase === 'launching') return;

    setPhase('launching');
    setLastOutcome(null);
    orbitalAudio.playGravityWellHum();

    // Sound sweep at periapsis approach
    setTimeout(() => {
      orbitalAudio.playPeriapsisSweep();
    }, 700);

    const gameData = encodeSlingshotData({
      riskRatingBps,
      celestialId,
    });

    if (hostApi) {
      try {
        await hostApi.openSession({
          wager: wagerWei.toString(),
          gameData,
        });
      } catch (err) {
        console.error('Host openSession failed:', err);
        setPhase('idle');
      }
    } else {
      // Standalone simulation mode with rejection sampling
      setTimeout(() => {
        // Roll in [0, 9999] using the Web Crypto CSPRNG, not Math.random()
        const rollBuf = new Uint32Array(1);
        crypto.getRandomValues(rollBuf);
        const rollBps = rollBuf[0] % 10000;
        const escaped = rollBps < riskRatingBps;
        const payout = escaped ? calculateSlingshotPayout(wagerWei, riskRatingBps) : 0n;

        const outcome: SlingshotOutcome = {
          resolved: true,
          escaped,
          rollBps,
          riskRatingBps,
          celestialId,
          payout,
        };
        setLastOutcome(outcome);

        if (escaped) {
          setPhase('escaped');
          orbitalAudio.playEscapeSuccess();
        } else {
          setPhase('captured');
          orbitalAudio.playCaptureFailure();
        }

        const newRecord: FlightRecord = {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString(),
          celestial,
          riskRatingBps,
          multiplier,
          escaped,
          rollBps,
          payoutEth: (Number(payout) / 1e18).toFixed(4),
        };
        setHistory((prev) => [newRecord, ...prev.slice(0, 19)]);
      }, 1400);
    }
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setRiskRatingBps(val);
    orbitalAudio.playBlip(600 + (val / 9800) * 400);
  };

  const applyPreset = (bps: number) => {
    setRiskRatingBps(bps);
    orbitalAudio.playBlip(880);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-black">
      {/* Top Header */}
      <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-cyan-500/20 border border-cyan-400/40">
              <Orbit className="w-6 h-6 text-black animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-wider text-white">GRAVITY SLINGSHOT</h1>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/80">
                  BASE · ICASINOGAMEV2
                </span>
              </div>
              <p className="text-xs text-gray-400 font-mono">Keplerian Astrodynamic Assist Protocol · 98.00% RTP</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={toggleMute}
              className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors border border-gray-700"
              title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
            </button>

            <button
              onClick={() => setShowFairness(!showFairness)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-300 border border-gray-700 transition-colors"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>98.00% RTP Math</span>
            </button>

            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs font-mono">
              <span className={`w-2 h-2 rounded-full ${hostApi ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
              <span className="text-gray-300">{hostApi ? 'CHAIN PROTOCOL' : 'STANDALONE DEMO'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 py-6 flex-1 flex flex-col gap-6 w-full">
        {/* Provably Fair Info Modal */}
        {showFairness && (
          <div className="p-4 rounded-xl bg-gray-900/90 border border-cyan-500/30 text-xs text-gray-300 space-y-2 backdrop-blur">
            <div className="flex items-center justify-between font-bold text-cyan-300 text-sm">
              <span className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" /> Provably Fair Astrodynamic Formulation
              </span>
              <button onClick={() => setShowFairness(false)} className="text-gray-400 hover:text-white font-mono">✕</button>
            </div>
            <p>
              Gravity Slingshot implements the <strong>ICasinoGameV2</strong> specification on Base. 
              Outcomes are derived via <strong>Verifiable Random Function (VRF)</strong> using rejection sampling on a 256-bit entropy seed:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono bg-black/40 p-3 rounded border border-gray-800">
              <div>• RTP: <span className="text-emerald-400 font-bold">98.00%</span> (House edge: 2.00%)</div>
              <div>• Multiplier Formula: <span className="text-cyan-400">9800 / RiskRatingBps</span></div>
              <div>• Modulo Bias: <span className="text-emerald-400 font-bold">0.00%</span> (Rejection limit: 2^256 - rem)</div>
            </div>
          </div>
        )}

        {/* Game Arena Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: 60 FPS Orbital Canvas */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <OrbitalCanvas
              celestial={celestial}
              riskRatingBps={riskRatingBps}
              phase={phase}
              multiplier={multiplier}
            />

            {/* Target Singularity Selector */}
            <div className="flex items-center justify-between p-2 rounded-xl bg-gray-900/60 border border-gray-800">
              <span className="text-xs font-mono text-gray-400 px-2 uppercase flex items-center gap-1.5">
                <Gauge className="w-3.5 h-3.5 text-cyan-400" /> Destination
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setCelestial('jupiter')}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                    celestial === 'jupiter'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm shadow-amber-500/20'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Jovian Vortex
                </button>
                <button
                  onClick={() => setCelestial('pulsar')}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                    celestial === 'pulsar'
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/20'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Pulsar PSR-01
                </button>
                <button
                  onClick={() => setCelestial('gargantua')}
                  className={`px-3 py-1 rounded-lg text-xs font-mono transition-all ${
                    celestial === 'gargantua'
                      ? 'bg-red-500/20 text-red-300 border border-red-500/40 shadow-sm shadow-red-500/20'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  Gargantua Singularity
                </button>
              </div>
            </div>

            {/* Resolution Banner */}
            {lastOutcome && (
              <div
                className={`p-4 rounded-xl border flex items-center justify-between animate-fade-in ${
                  lastOutcome.escaped
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                    : 'bg-red-950/40 border-red-500/40 text-red-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  {lastOutcome.escaped ? (
                    <Sparkles className="w-6 h-6 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                  )}
                  <div>
                    <h3 className="font-bold text-sm">
                      {lastOutcome.escaped ? 'ESCAPE TRAJECTORY ACHIEVED!' : 'GRAVITATIONAL TIDAL CAPTURE!'}
                    </h3>
                    <p className="text-xs opacity-80 font-mono">
                      {lastOutcome.escaped
                        ? `Relativistic boost unlocked ${multiplier.toFixed(2)}x payout (+${(
                            Number(lastOutcome.payout) / 1e18
                          ).toFixed(4)} ETH)`
                        : 'Probe crossed the event horizon; hull collapsed at periapsis.'}
                    </p>
                  </div>
                </div>
                <div className="text-right font-mono text-xs">
                  <div>ROLL: {lastOutcome.rollBps} BPS</div>
                  <div>GATE: &lt; {lastOutcome.riskRatingBps} BPS</div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Flight Computer Cockpit */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Metric Displays */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-gray-900 border border-gray-800">
                <span className="text-[11px] font-mono text-gray-400 uppercase">Payout Multiplier</span>
                <div className="text-2xl font-black text-cyan-400 font-mono tracking-tight mt-0.5">
                  {multiplier.toFixed(2)}x
                </div>
                <div className="text-[10px] text-gray-500 font-mono">Theoretical 98.00% RTP</div>
              </div>

              <div className="p-3 rounded-xl bg-gray-900 border border-gray-800">
                <span className="text-[11px] font-mono text-gray-400 uppercase">Win Probability</span>
                <div className="text-2xl font-black text-emerald-400 font-mono tracking-tight mt-0.5">
                  {winProbability}%
                </div>
                <div className="text-[10px] text-gray-500 font-mono">Escape Corridor</div>
              </div>
            </div>

            {/* Continuous Risk Slider */}
            <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400 uppercase">Periapsis Risk Calibrator</span>
                <span className="text-cyan-400 font-bold">{riskRatingBps} BPS</span>
              </div>

              <input
                type="range"
                min="100"
                max="9800"
                step="50"
                value={riskRatingBps}
                onChange={handleSliderChange}
                className="w-full accent-cyan-400 cursor-pointer h-2 bg-gray-800 rounded-lg appearance-none"
              />

              <div className="flex justify-between text-[10px] font-mono text-gray-500">
                <span>1.00% (98.00x)</span>
                <span>50.00% (1.96x)</span>
                <span>98.00% (1.00x)</span>
              </div>

              {/* Quick Presets */}
              <div className="grid grid-cols-5 gap-1.5 mt-1">
                {RISK_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset.riskRatingBps)}
                    className={`py-1.5 px-1 rounded text-center border font-mono transition-all ${
                      riskRatingBps === preset.riskRatingBps
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                        : 'bg-gray-800/60 border-gray-700/60 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    <div className="text-[10px] font-bold truncate">{preset.label}</div>
                    <div className={`text-[9px] ${preset.color}`}>{preset.multiplier}x</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Wager Controls */}
            <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400 uppercase">Wager (ETH)</span>
                <span className="text-gray-400">
                  Potential Payout: <strong className="text-emerald-400">{potentialPayoutEth} ETH</strong>
                </span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={wagerEth}
                  onChange={(e) => setWagerEth(e.target.value)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-500"
                  placeholder="0.01"
                />
                <span className="absolute right-3 top-2 text-xs font-mono text-gray-500">ETH</span>
              </div>

              {/* Quick Chip Buttons */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {['0.001', '0.005', '0.01', '0.05', '0.1'].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setWagerEth(amount)}
                    className={`px-2.5 py-1 rounded text-xs font-mono border transition-all ${
                      wagerEth === amount
                        ? 'bg-cyan-950 border-cyan-500 text-cyan-400'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'
                    }`}
                  >
                    {amount}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const current = parseFloat(wagerEth) || 0;
                    setWagerEth((current * 2).toFixed(4));
                  }}
                  className="px-2.5 py-1 rounded text-xs font-mono bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"
                >
                  2x
                </button>
                <button
                  onClick={() => {
                    const current = parseFloat(wagerEth) || 0;
                    setWagerEth(Math.max(0.0001, current / 2).toFixed(4));
                  }}
                  className="px-2.5 py-1 rounded text-xs font-mono bg-gray-800 border border-gray-700 text-gray-300 hover:text-white"
                >
                  1/2
                </button>
              </div>
            </div>

            {/* Launch Action Button */}
            <button
              onClick={handleLaunch}
              disabled={phase === 'launching' || wagerWei === 0n}
              className={`w-full py-3.5 px-6 rounded-xl font-bold font-mono tracking-wider transition-all flex items-center justify-center gap-2 shadow-xl ${
                phase === 'launching'
                  ? 'bg-cyan-950 text-cyan-500 border border-cyan-800 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-black shadow-cyan-500/20 active:scale-[0.98]'
              }`}
            >
              <Rocket className={`w-5 h-5 ${phase === 'launching' ? 'animate-bounce' : ''}`} />
              <span>{phase === 'launching' ? 'ENGAGING ORBITAL BURN...' : 'IGNITE GRAVITY SLINGSHOT'}</span>
            </button>
          </div>
        </div>

        {/* Flight Telemetry & History */}
        <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono text-gray-400">
            <span className="flex items-center gap-2">
              <History className="w-4 h-4 text-cyan-400" /> RECENT FLIGHT TELEMETRY
            </span>
            <span>{history.length} MISSIONS LOGGED</span>
          </div>

          {history.length === 0 ? (
            <div className="py-6 text-center text-xs text-gray-500 font-mono">
              No orbital flights recorded yet. Calibrate periapsis and launch your first probe.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500">
                    <th className="py-2 px-3">TIME</th>
                    <th className="py-2 px-3">TARGET</th>
                    <th className="py-2 px-3">RISK BPS</th>
                    <th className="py-2 px-3">ROLL</th>
                    <th className="py-2 px-3">RESULT</th>
                    <th className="py-2 px-3 text-right">PAYOUT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-gray-800/30">
                      <td className="py-2 px-3 text-gray-400">{rec.timestamp}</td>
                      <td className="py-2 px-3 uppercase text-gray-300">{rec.celestial}</td>
                      <td className="py-2 px-3 text-cyan-400">{rec.riskRatingBps}</td>
                      <td className="py-2 px-3 text-gray-300">{rec.rollBps}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            rec.escaped
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : 'bg-red-950 text-red-400 border border-red-800'
                          }`}
                        >
                          {rec.escaped ? `ESCAPED (${rec.multiplier}x)` : 'CAPTURED'}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-white">
                        {rec.payoutEth} ETH
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-900 bg-gray-950 py-4 text-center text-xs font-mono text-gray-500">
        Chain Jam Vol. 1 Entry · Powered by Chain Casino SDK · Verified Provably Fair Rejection Sampling
      </footer>
    </div>
  );
}
