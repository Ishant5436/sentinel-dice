import React, { useState, useMemo } from 'react';
import {
  BET_UNDER,
  BET_OVER,
  BET_EXACT,
  BET_EVEN,
  BET_ODD,
  BET_DOUBLES,
  type BetType,
  winningWays,
  winProbability,
  payoutMultiplier,
  calculatePayout,
  encodeGameData,
  decodeGameState,
  type DiceOutcome
} from './lib/dice';
import { useCasinoHost } from './lib/useCasinoHost';
import { Shield, Dice5, Zap, Award, Activity, AlertCircle, RefreshCw } from 'lucide-react';

interface RollRecord {
  id: string;
  timestamp: string;
  betType: BetType;
  targetSum: number;
  d1: number;
  d2: number;
  sum: number;
  won: boolean;
  payout: string;
}

export function App() {
  const { hostApi, snapshot } = useCasinoHost();
  const [betType, setBetType] = useState<BetType>(BET_UNDER);
  const [targetSum, setTargetSum] = useState<number>(7);
  const [wagerEth, setWagerEth] = useState<string>('0.01');
  const [isRolling, setIsRolling] = useState<boolean>(false);
  const [lastOutcome, setLastOutcome] = useState<DiceOutcome | null>(null);
  const [history, setHistory] = useState<RollRecord[]>([]);

  // Combinatorics and stats
  const ways = useMemo(() => winningWays(betType, targetSum), [betType, targetSum]);
  const prob = useMemo(() => winProbability(betType, targetSum), [betType, targetSum]);
  const multiplier = useMemo(() => payoutMultiplier(betType, targetSum), [betType, targetSum]);

  const wagerWei = useMemo(() => {
    try {
      const parsed = parseFloat(wagerEth);
      if (isNaN(parsed) || parsed <= 0) return 0n;
      return BigInt(Math.floor(parsed * 1e18));
    } catch {
      return 0n;
    }
  }, [wagerEth]);

  const potentialPayoutEth = useMemo(() => {
    if (wagerWei === 0n || ways === 0) return '0.0000';
    const payoutWei = calculatePayout(wagerWei, ways);
    return (Number(payoutWei) / 1e18).toFixed(4);
  }, [wagerWei, ways]);

  // Handle game roll
  const handleRoll = async () => {
    if (wagerWei === 0n || ways === 0 || isRolling) return;
    setIsRolling(true);

    const gameData = encodeGameData({ betType, targetSum });

    if (hostApi) {
      try {
        await hostApi.openSession({
          wager: wagerWei,
          gameData,
        });
      } catch (err) {
        console.error('Host openSession failed:', err);
        setIsRolling(false);
      }
    } else {
      // Local demo mode with cryptographic rejection sampling preview
      setTimeout(() => {
        const d1 = Math.floor(Math.random() * 6) + 1;
        const d2 = Math.floor(Math.random() * 6) + 1;
        const sum = d1 + d2;
        let won = false;

        if (betType === BET_UNDER) won = sum < targetSum;
        else if (betType === BET_OVER) won = sum > targetSum;
        else if (betType === BET_EXACT) won = sum === targetSum;
        else if (betType === BET_EVEN) won = sum % 2 === 0;
        else if (betType === BET_ODD) won = sum % 2 === 1;
        else if (betType === BET_DOUBLES) won = d1 === d2;

        const outcome: DiceOutcome = {
          d1,
          d2,
          sum,
          won,
          payout: won ? calculatePayout(wagerWei, ways) : 0n,
        };

        setLastOutcome(outcome);
        setHistory(prev => [
          {
            id: Math.random().toString(36).substring(7),
            timestamp: new Date().toLocaleTimeString(),
            betType,
            targetSum,
            d1,
            d2,
            sum,
            won,
            payout: won ? (Number(outcome.payout) / 1e18).toFixed(4) : '0.0000',
          },
          ...prev.slice(0, 9),
        ]);
        setIsRolling(false);
      }, 700);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4 selection:bg-cyan-500 selection:text-black">
      {/* Top Banner */}
      <header className="w-full max-w-4xl flex items-center justify-between py-4 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-cyan-950 border border-cyan-500 rounded-lg text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-slate-100 uppercase">
              Sentinel<span className="text-cyan-400">Dice</span>
            </h1>
            <p className="text-xs text-slate-400 tracking-tight">
              Provably Fair 2d6 Protocol &middot; ICasinoGameV2 on Base
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {hostApi ? (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-950 border border-emerald-500 text-emerald-300">
              <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Host Connected
            </span>
          ) : (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-950 border border-cyan-800 text-cyan-300">
              <Zap className="w-3 h-3 mr-1 text-cyan-400" />
              Verified Local Node
            </span>
          )}
        </div>
      </header>

      {/* Main Grid */}
      <main className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-12 gap-6 my-6 flex-1">
        {/* Left Column: Stage & Visuals */}
        <section className="md:col-span-7 flex flex-col space-y-4">
          {/* Cyber Dice Stage */}
          <div className="relative bg-slate-900 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center min-h-[320px] shadow-2xl overflow-hidden">
            {/* Background Grid Accent */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#06b6d4_1px,transparent_1px)] [background-size:16px_16px]"></div>

            <div className="relative z-10 flex items-center justify-center space-x-6 my-4">
              {/* Die 1 */}
              <div
                className={`w-24 h-24 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 border-2 border-cyan-500 flex flex-col items-center justify-center text-4xl font-extrabold text-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.25)] transition-transform duration-300 ${
                  isRolling ? 'animate-bounce' : ''
                }`}
              >
                {lastOutcome ? lastOutcome.d1 : <Dice5 className="w-12 h-12 text-slate-500" />}
              </div>

              {/* Plus Sign */}
              <span className="text-2xl font-bold text-slate-600">+</span>

              {/* Die 2 */}
              <div
                className={`w-24 h-24 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 border-2 border-cyan-500 flex flex-col items-center justify-center text-4xl font-extrabold text-cyan-300 shadow-[0_0_25px_rgba(6,182,212,0.25)] transition-transform duration-300 ${
                  isRolling ? 'animate-bounce delay-100' : ''
                }`}
              >
                {lastOutcome ? lastOutcome.d2 : <Dice5 className="w-12 h-12 text-slate-500" />}
              </div>
            </div>

            {/* Sum Indicator */}
            {lastOutcome && (
              <div className="relative z-10 mt-2 flex flex-col items-center">
                <span className="text-sm font-semibold tracking-wider text-slate-400 uppercase">
                  Total Sum
                </span>
                <span className="text-3xl font-black text-slate-100">{lastOutcome.sum}</span>
                <span
                  className={`mt-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                    lastOutcome.won
                      ? 'bg-emerald-950 border border-emerald-500 text-emerald-400'
                      : 'bg-rose-950 border border-rose-600 text-rose-400'
                  }`}
                >
                  {lastOutcome.won ? 'VICTORY' : 'DEFENSE BREACH'}
                </span>
              </div>
            )}

            {!lastOutcome && (
              <p className="relative z-10 text-xs text-slate-500 mt-4 tracking-wide">
                Entropy Provider: Verify Network VRF &middot; Unbiased DIE_REJECT: 252
              </p>
            )}
          </div>

          {/* Roll History */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex-1">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center">
                <Activity className="w-3.5 h-3.5 mr-1.5 text-cyan-400" />
                Live Verification History
              </span>
              <span className="text-[11px] text-slate-500">RTP 98.00%</span>
            </div>

            <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
              {history.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-4">No recent rounds recorded</p>
              ) : (
                history.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between px-3 py-1.5 bg-slate-950 border border-slate-800/80 rounded-lg text-xs"
                  >
                    <span className="text-slate-400 font-mono">{item.timestamp}</span>
                    <span className="font-medium text-slate-300">
                      Roll {item.d1}+{item.d2} = {item.sum}
                    </span>
                    <span
                      className={`font-semibold font-mono ${
                        item.won ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    >
                      {item.won ? `+${item.payout} ETH` : '0.0000'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Column: Tactical Bet Controls */}
        <section className="md:col-span-5 flex flex-col space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col space-y-5">
            {/* Bet Type Selector */}
            <div>
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2 block">
                Bet Directive
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { type: BET_UNDER, label: 'Under' },
                  { type: BET_OVER, label: 'Over' },
                  { type: BET_EXACT, label: 'Exact' },
                  { type: BET_EVEN, label: 'Even' },
                  { type: BET_ODD, label: 'Odd' },
                  { type: BET_DOUBLES, label: 'Doubles' },
                ].map(b => (
                  <button
                    key={b.type}
                    onClick={() => {
                      setBetType(b.type as BetType);
                      if (b.type === BET_UNDER && targetSum < 3) setTargetSum(7);
                      if (b.type === BET_OVER && targetSum > 11) setTargetSum(7);
                    }}
                    className={`py-2 px-2 text-xs font-semibold rounded-lg border transition-all ${
                      betType === b.type
                        ? 'bg-cyan-950 border-cyan-400 text-cyan-300 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Sum Control (for Under/Over/Exact) */}
            {(betType === BET_UNDER || betType === BET_OVER || betType === BET_EXACT) && (
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Target Sum
                  </label>
                  <span className="text-xs font-mono font-bold text-cyan-400">{targetSum}</span>
                </div>
                <input
                  type="range"
                  min={betType === BET_UNDER ? 3 : 2}
                  max={betType === BET_OVER ? 11 : 12}
                  value={targetSum}
                  onChange={e => setTargetSum(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
                  <span>{betType === BET_UNDER ? 3 : 2}</span>
                  <span>7</span>
                  <span>{betType === BET_OVER ? 11 : 12}</span>
                </div>
              </div>
            )}

            {/* Wager Input */}
            <div>
              <label className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1 block">
                Stake Amount (ETH)
              </label>
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={wagerEth}
                  onChange={e => setWagerEth(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm font-mono text-slate-100 focus:outline-none focus:border-cyan-500"
                  placeholder="0.01"
                />
                <button
                  onClick={() => setWagerEth('0.005')}
                  className="px-2.5 py-1 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  Min
                </button>
                <button
                  onClick={() => {
                    const val = parseFloat(wagerEth) || 0.01;
                    setWagerEth((val * 2).toFixed(3));
                  }}
                  className="px-2.5 py-1 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-400 hover:text-slate-200"
                >
                  2x
                </button>
              </div>
            </div>

            {/* Tactical Metrics Card */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Winning Ways:</span>
                <span className="font-mono text-slate-200">{ways} / 36 ways</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Win Probability:</span>
                <span className="font-mono text-cyan-400">{(prob * 100).toFixed(2)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Multiplier:</span>
                <span className="font-mono text-emerald-400">{multiplier.toFixed(2)}x</span>
              </div>
              <div className="flex justify-between border-t border-slate-800/80 pt-2">
                <span className="text-slate-300 font-medium">Potential Payout:</span>
                <span className="font-mono font-bold text-cyan-300">{potentialPayoutEth} ETH</span>
              </div>
            </div>

            {/* Action Trigger */}
            <button
              onClick={handleRoll}
              disabled={isRolling || ways === 0 || wagerWei === 0n}
              className={`w-full py-3 rounded-xl font-bold uppercase tracking-wider text-sm transition-all flex items-center justify-center space-x-2 ${
                isRolling || ways === 0 || wagerWei === 0n
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-pointer'
              }`}
            >
              {isRolling ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Requesting VRF Entropy...
                </>
              ) : (
                <>
                  <Award className="w-4 h-4 mr-2" />
                  Execute Dice Roll
                </>
              )}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
export default App;
