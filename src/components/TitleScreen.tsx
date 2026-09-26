import React, { useEffect } from 'react';
import { Rocket } from 'lucide-react';
import { maxPayoutMultiplier } from '../lib/slingshot';

const TITLE_KEY = 'grand-tour-title-seen';

/** The title card shows once per browser session; the Begin click also unlocks Web Audio. */
export function titleAlreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(TITLE_KEY) === '1';
  } catch (err: unknown) {
    console.warn('Title preference unavailable:', err);
    return false;
  }
}

function markTitleSeen() {
  try {
    window.sessionStorage.setItem(TITLE_KEY, '1');
  } catch (err: unknown) {
    console.warn('Title preference not saved:', err);
  }
}

const CHIPS = [`TOP ROUTE x${maxPayoutMultiplier(2).toFixed(2)}`, '8 WORLDS', '93% RTP ON EVERY ROUTE', 'CHAIN VRF'];

interface TitleProps {
  open: boolean;
  onBegin: () => void;
  rankName: string;
  tours: number;
  level: number;
  dayStreak: number;
  missionsLeft: number;
  worldsCharted: number;
}

export function TitleScreen({ open, onBegin, rankName, tours, level, dayStreak, missionsLeft, worldsCharted }: TitleProps) {
  const begin = () => {
    markTitleSeen();
    onBegin();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      // Capture phase: the game's own Space/Enter launch shortcut must not fire from here.
      e.preventDefault();
      e.stopImmediatePropagation();
      begin();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-hull-950" role="dialog" aria-modal aria-label="Grand Tour title screen">
      <div className="absolute inset-0 bg-cover bg-[62%_center] title-drift" style={{ backgroundImage: 'url(./title-bg.webp)' }} />
      <div className="absolute inset-0 bg-gradient-to-r from-hull-950/95 via-hull-950/55 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-hull-950 via-transparent to-hull-950/50" />
      <div className="relative h-full flex flex-col justify-center px-6 sm:px-14 max-w-3xl">
        <div className="text-[11px] sm:text-xs tracking-[0.55em] text-flare-400">GRAVITY SLINGSHOT</div>
        <h1 className="title-logo font-display text-5xl sm:text-7xl leading-[0.95] mt-3">
          GRAND
          <br />
          TOUR
        </h1>
        <div className="mt-4 h-[3px] w-40 rounded-full bg-gradient-to-r from-nebula-500 via-flare-500 to-transparent" />
        <p className="mt-5 text-hull-300 text-sm sm:text-base max-w-md leading-relaxed">
          Chart a course across the galaxy: comets, ringed Saturn, a dying red giant, a pulsar and a black hole. Every assist multiplies your tour value. Bank it any time, or burn onward. Every roll comes from Chain VRF.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          {CHIPS.map(chip => (
            <span key={chip} className="px-2.5 py-1 rounded-full border border-hull-600 bg-hull-900/70 text-[10px] tracking-widest text-hull-300 backdrop-blur">
              {chip}
            </span>
          ))}
        </div>
        <button
          onClick={begin}
          autoFocus
          className="btn-shimmer mt-8 w-fit relative overflow-hidden flex items-center gap-3 px-8 py-4 rounded-xl font-display text-sm sm:text-base tracking-[0.25em] text-hull-950 bg-gradient-to-r from-flare-400 to-flare-200 shadow-[0_0_40px_rgba(255,138,31,0.45)] hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-flare-200"
        >
          <Rocket className="w-5 h-5" /> BEGIN MISSION
        </button>
        <div className="mt-3 text-[11px] text-hull-400">Press Enter. Sound and music start here.</div>
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            { label: dayStreak > 1 ? `DAY ${dayStreak} STREAK` : 'DAY 1 OF YOUR STREAK', tone: 'text-flare-300 border-flare-500/40' },
            { label: missionsLeft > 0 ? `${missionsLeft} DAILY MISSION${missionsLeft === 1 ? '' : 'S'} WAITING` : 'DAILY MISSIONS CLEAR', tone: 'text-mint-300 border-mint-400/40' },
            { label: `${worldsCharted}/8 WORLDS CHARTED`, tone: 'text-cyan-200 border-cyan-300/40' },
            { label: `PILOT LV ${level}`, tone: 'text-nebula-300 border-nebula-400/40' },
          ].map(item => (
            <span key={item.label} className={`px-2.5 py-1 rounded-lg border bg-hull-950/60 text-[10px] tracking-widest ${item.tone}`}>
              {item.label}
            </span>
          ))}
        </div>
        {tours > 0 && (
          <div className="mt-3 text-xs text-hull-300">
            Welcome back, <span className="text-flare-300">{rankName}</span>. {tours} tour{tours === 1 ? '' : 's'} on record.
          </div>
        )}
      </div>
    </div>
  );
}
