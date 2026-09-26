import React, { useEffect } from 'react';
import { useCountUp } from '../lib/useCountUp';

export interface Win {
  key: number;
  /** Paid multiple of the stake (payout / wager). */
  multiple: number;
  amount: number;
  symbol: string;
}

const TIERS = [
  { min: 500, label: 'COSMIC WIN', gradient: 'from-nebula-300 via-flare-200 to-mint-300', glow: 'rgba(191, 140, 255, 0.55)' },
  { min: 100, label: 'MEGA WIN', gradient: 'from-flare-200 via-flare-400 to-ember-300', glow: 'rgba(255, 138, 31, 0.5)' },
  { min: 25, label: 'HUGE WIN', gradient: 'from-mint-300 via-cyan-200 to-flare-200', glow: 'rgba(52, 224, 161, 0.45)' },
  { min: 5, label: 'BIG WIN', gradient: 'from-flare-200 to-flare-400', glow: 'rgba(255, 171, 77, 0.4)' },
] as const;

export const winTier = (multiple: number) => TIERS.find(tier => multiple >= tier.min) ?? null;

// Fixed sparkle layout (deterministic, so re-renders do not reshuffle it).
const SPARKS = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: (i % 12) * 0.12,
  size: 3 + (i % 4),
  drift: ((i * 53) % 40) - 20,
}));

/** Full-screen celebration for banked tours of x5 and up; click or wait 3.2 s to dismiss. */
export function WinCelebration({ win, onDone }: { win: Win | null; onDone: () => void }) {
  const tier = win ? winTier(win.multiple) : null;
  const shown = useCountUp(win && tier ? win.amount : 0, 1400);
  useEffect(() => {
    if (!win || !tier) return;
    const id = setTimeout(onDone, 3200);
    return () => clearTimeout(id);
  }, [win, tier, onDone]);
  if (!win || !tier) return null;
  const digits = win.amount >= 100 ? 2 : 4;
  return (
    <div
      key={win.key}
      className="fixed inset-0 z-40 flex items-center justify-center cursor-pointer"
      style={{ background: `radial-gradient(circle at center, ${tier.glow}, rgba(8, 6, 15, 0.55) 55%, rgba(8, 6, 15, 0) 80%)` }}
      onClick={onDone}
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {SPARKS.map((s, i) => (
          <span
            key={i}
            className="win-spark absolute bottom-[-10px] rounded-full bg-flare-200"
            style={{ left: `${s.left}%`, width: s.size, height: s.size, animationDelay: `${s.delay}s`, ['--drift' as string]: `${s.drift}px` }}
          />
        ))}
      </div>
      <div className="relative text-center animate-pop">
        <div className={`font-display text-5xl sm:text-7xl bg-gradient-to-r ${tier.gradient} bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(255,171,77,0.45)]`}>
          {tier.label}
        </div>
        <div className="mt-3 font-display text-3xl sm:text-4xl text-hull-100 tabular-nums">
          +{shown.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} <span className="text-flare-300 text-xl">{win.symbol}</span>
        </div>
        <div className="mt-1 text-sm tracking-[0.3em] text-hull-300">x{win.multiple.toFixed(2)} THE STAKE</div>
      </div>
    </div>
  );
}
