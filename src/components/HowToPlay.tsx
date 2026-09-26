import React from 'react';
import { X } from 'lucide-react';
import { BODIES, type BodyId } from '../lib/slingshot';
import { BodyArt } from './BodyArt';

const HELP_KEY = 'grand-tour-help-seen';

export function helpAlreadySeen(): boolean {
  try {
    return window.localStorage.getItem(HELP_KEY) === '1';
  } catch (err: unknown) {
    console.warn('Help preference unavailable:', err);
    return false;
  }
}

function markHelpSeen() {
  try {
    window.localStorage.setItem(HELP_KEY, '1');
  } catch (err: unknown) {
    console.warn('Help preference not saved:', err);
  }
}

const STEPS = [
  {
    title: 'Pick a body',
    text: 'Each assist is a gamble. Safe bodies pay a little, wild ones pay a lot.',
  },
  {
    title: 'Survive, then choose',
    text: 'Survive the slingshot and your tour value multiplies. Eject to bank it, or burn on to a new body. You can never reuse the body you just left.',
  },
  {
    title: 'Up to four assists',
    text: 'Chain the right route and the Grand Tour pays up to x952.32. Get captured and the tour is lost.',
  },
];

export function HowToPlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const close = () => {
    markHelpSeen();
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-hull-950/80 backdrop-blur-sm p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal
        aria-label="How to play"
        className="relative w-full max-w-lg rounded-2xl border border-nebula-500/40 bg-hull-900 shadow-2xl shadow-nebula-600/20 p-6 animate-pop"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={close} className="absolute top-3 right-3 p-1.5 rounded-lg text-hull-400 hover:text-hull-100 hover:bg-hull-800" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
        <div className="text-[11px] tracking-[0.3em] text-flare-400">HOW TO PLAY</div>
        <h2 className="font-display text-xl text-hull-100 mt-1">The Grand Tour</h2>
        <ol className="mt-4 space-y-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-nebula-500 to-flare-500 text-hull-950 font-bold text-sm flex items-center justify-center">
                {i + 1}
              </span>
              <div>
                <div className="font-semibold text-hull-100">{step.title}</div>
                <div className="text-sm text-hull-300">{step.text}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid grid-cols-4 gap-2">
          {BODIES.map(b => (
            <div key={b.id} className="rounded-lg border border-hull-700 bg-hull-850 p-2 flex flex-col items-center text-center">
              <BodyArt body={b.id as BodyId} size={40} />
              <div className="text-xs font-semibold text-hull-100 mt-1">{b.name}</div>
              <div className="text-[10px] text-hull-400">{b.surviveBps / 100}% | {b.multLabel}</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-hull-400">
          Fair by design: survive chance x multiplier is 1.00 on every leg and the 7% house edge is taken once when you bank, so every route returns 93% on average. Outcomes come from Chain's on-chain VRF.
        </p>
        <button
          onClick={close}
          className="mt-5 w-full py-3 rounded-xl font-bold tracking-wider text-white bg-gradient-to-r from-nebula-500 to-flare-500 hover:brightness-110"
        >
          START THE TOUR
        </button>
      </div>
    </div>
  );
}
