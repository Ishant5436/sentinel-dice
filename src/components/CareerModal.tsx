import React from 'react';
import { Award, Lock, X } from 'lucide-react';
import { BADGES, rankFor, type Career } from '../lib/career';

export function CareerModal({ open, onClose, career }: { open: boolean; onClose: () => void; career: Career }) {
  if (!open) return null;
  const { rank, next, progress } = rankFor(career.lightYears);
  const stats = [
    ['Tours flown', String(career.tours)],
    ['Light-years flown', career.lightYears.toFixed(1)],
    ['Black holes survived', String(career.blackHolesSurvived)],
    ['Top multiplier banked', career.topMultiplier ? `x${career.topMultiplier.toFixed(2)}` : '--'],
    ['Grand Tours completed', String(career.grandTours)],
    ['Successful banks', String(career.banks)],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-hull-950/80 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="Pilot career"
        className="relative w-full max-w-md rounded-2xl border border-flare-500/40 bg-hull-900 p-6 animate-pop"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg text-hull-400 hover:text-hull-100 hover:bg-hull-800" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
        <div className="text-[11px] tracking-[0.3em] text-flare-400">PILOT CAREER</div>
        <h2 className="font-display text-lg text-hull-100 mt-1">{rank.name.toUpperCase()}</h2>
        <div className="mt-2 h-2 rounded-full bg-hull-800 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-nebula-500 to-flare-500" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-hull-400">
          {next ? `${(next.min - career.lightYears).toFixed(1)} light-years to ${next.name}` : 'Highest rank reached'}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-hull-700 bg-hull-850 p-2">
              <div className="text-[10px] text-hull-400">{label}</div>
              <div className="text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 text-[11px] tracking-widest text-hull-400">BADGES</div>
        <ul className="mt-2 space-y-1.5">
          {BADGES.map(badge => {
            const earned = career.badges.includes(badge.id);
            return (
              <li key={badge.id} className={`flex items-center gap-2 rounded-lg border p-2 ${earned ? 'border-flare-400/50 bg-flare-500/10' : 'border-hull-700 opacity-60'}`}>
                {earned ? <Award className="w-4 h-4 text-flare-300" /> : <Lock className="w-4 h-4 text-hull-600" />}
                <div>
                  <div className="text-xs font-semibold">{badge.name}</div>
                  <div className="text-[10px] text-hull-400">{badge.desc}</div>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[10px] text-hull-600">Career stats live in this browser only.</p>
      </div>
    </div>
  );
}
