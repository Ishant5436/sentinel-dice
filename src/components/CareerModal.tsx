import React, { useEffect, useRef } from 'react';
import { Crown, Lock, Rocket, Trophy, X } from 'lucide-react';
import { BADGES, CHASSIS, RANKS, levelFor, rankFor, type Career, type ChassisId } from '../lib/career';
import { BODIES, BODY_ORDER } from '../lib/slingshot';
import { CODEX } from '../lib/flight';
import { BodyArt } from './BodyArt';
import { drawProbe } from './canvas/craft';

const BADGE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  'escape-velocity': Rocket,
  'singularity-survivor': SingularityIcon,
  'grand-tour-ace': Trophy,
  'top-route': Crown,
};

/** Black hole glyph in the lucide style (24px grid, stroke icon). */
function SingularityIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" {...props}>
      <ellipse cx="12" cy="12" rx="10" ry="3.5" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" fillOpacity={0.25} />
    </svg>
  );
}

/** Foil card that tilts toward the pointer, with a moving glare and a color-dodge rainbow sheen. */
function HoloCard({ earned, children }: { earned: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const setVars = (rx: number, ry: number, mx: number, my: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--rx', `${rx}deg`);
    el.style.setProperty('--ry', `${ry}deg`);
    el.style.setProperty('--mx', `${mx}%`);
    el.style.setProperty('--my', `${my}%`);
  };
  return (
    <div
      ref={ref}
      className={`holo-card ${earned ? 'holo-earned' : 'holo-locked'}`}
      onPointerMove={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        setVars((0.5 - py) * 18, (px - 0.5) * 22, px * 100, py * 100);
      }}
      onPointerLeave={() => setVars(0, 0, 50, 50)}
    >
      {children}
    </div>
  );
}

/** Animated hull preview drawn with the same renderer as the flight scene. */
function ChassisPreview({ chassis, locked }: { chassis: ChassisId; locked: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = 132 * dpr;
    canvas.height = 64 * dpr;
    let raf = 0;
    const draw = (now: number) => {
      const t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, 132, 64);
      ctx.fillStyle = 'rgba(226, 232, 240, 0.35)';
      for (let i = 0; i < 14; i++) {
        const x = (132 - ((t * 30 * (1 + (i % 3)) + i * 37) % 132)) % 132;
        ctx.fillRect(x, (i * 23) % 64, 2 + (i % 3), 1);
      }
      ctx.translate(74, 32 + Math.sin(t * 1.6) * 2);
      ctx.scale(2.1, 2.1);
      drawProbe(ctx, chassis, t, locked ? 0 : 0.8);
      if (!locked) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [chassis, locked]);
  return <canvas ref={ref} className={`w-[132px] h-16 ${locked ? 'grayscale opacity-40' : ''}`} aria-hidden />;
}

export function CareerModal({ open, onClose, career }: { open: boolean; onClose: () => void; career: Career }) {
  if (!open) return null;
  const { rank, index, next, progress } = rankFor(career.lightYears);
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
        className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl border border-flare-500/40 bg-hull-900 bg-[radial-gradient(ellipse_at_top,rgba(157,92,255,0.18),transparent_60%)] p-5 sm:p-6 animate-pop"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute top-3 right-3 p-1.5 rounded-lg text-hull-400 hover:text-hull-100 hover:bg-hull-800" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
        <div className="text-[11px] tracking-[0.3em] text-flare-400">PILOT DOSSIER</div>
        <h2 className="font-display text-xl text-hull-100 mt-1">{rank.name.toUpperCase()}</h2>
        <div className="mt-2 h-2 rounded-full bg-hull-800 overflow-hidden">
          <div className="h-full bg-gradient-to-r from-nebula-500 to-flare-500" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-hull-400">
          {next ? `${(next.min - career.lightYears).toFixed(1)} light-years to ${next.name}` : 'Highest rank reached'}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-display text-flare-300">LEVEL {levelFor(career.xp).level}</span>
          <span className="text-hull-400">
            {levelFor(career.xp).into} / {levelFor(career.xp).span} XP
          </span>
          <span className="text-hull-600">|</span>
          <span className="text-flare-300">Day streak {career.dayStreak}</span>
          <span className="text-hull-600">|</span>
          <span className="text-flare-300">Best bank streak {career.bestWinStreak}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-hull-700 bg-hull-850 p-2">
              <div className="text-[10px] text-hull-400">{label}</div>
              <div className="text-sm font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 text-[11px] tracking-widest text-hull-400">BADGES</div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BADGES.map(badge => {
            const earned = career.badges.includes(badge.id);
            const Icon = BADGE_ICON[badge.id] ?? Trophy;
            return (
              <HoloCard key={badge.id} earned={earned}>
                <div className="relative z-10 flex flex-col items-center text-center px-2 py-4 h-full">
                  <div className={`w-14 h-14 rounded-full flex items-center justify-center border-2 ${earned ? 'border-flare-300 bg-gradient-to-br from-flare-500/40 to-nebula-600/40 text-flare-200' : 'border-hull-600 text-hull-600'}`}>
                    {earned ? <Icon className="w-7 h-7" /> : <Lock className="w-6 h-6" />}
                  </div>
                  <div className="mt-2 text-xs font-semibold leading-tight">{badge.name}</div>
                  <div className="mt-1 text-[10px] text-hull-400 leading-snug">{badge.desc}</div>
                  <div className={`mt-auto pt-2 text-[9px] tracking-[0.25em] ${earned ? 'text-flare-300' : 'text-hull-600'}`}>{earned ? 'EARNED' : 'LOCKED'}</div>
                </div>
              </HoloCard>
            );
          })}
        </div>

        <div className="mt-5 flex items-baseline justify-between text-[11px] tracking-widest text-hull-400">
          <span>GALAXY CODEX</span>
          <span className="tracking-normal text-cyan-200">{career.discovered.length} / 8 worlds charted</span>
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BODY_ORDER.map(id => {
            const charted = career.discovered.includes(id);
            return (
              <div key={id} className={`rounded-xl border p-2 flex flex-col items-center text-center ${charted ? 'border-cyan-300/40 bg-cyan-300/5' : 'border-hull-700 bg-hull-850'}`}>
                <BodyArt body={id} size={40} className={charted ? '' : 'grayscale brightness-[0.25]'} />
                <div className={`mt-1 text-xs font-semibold ${charted ? 'text-hull-100' : 'text-hull-600'}`}>{charted ? BODIES[id].name : 'Uncharted'}</div>
                <div className="text-[10px] leading-snug text-hull-400">{charted ? CODEX[id] : 'Survive an assist here to chart it.'}</div>
              </div>
            );
          })}
        </div>

        <div className="mt-5 text-[11px] tracking-widest text-hull-400">HULLS</div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CHASSIS.map((hull, i) => {
            const locked = i > index;
            return (
              <div key={hull.name} className={`rounded-xl border p-2 flex flex-col items-center text-center ${i === index ? 'border-flare-400/70 bg-flare-500/10' : 'border-hull-700 bg-hull-850'}`}>
                <ChassisPreview chassis={i as ChassisId} locked={locked} />
                <div className="text-xs font-semibold">{hull.name}</div>
                <div className="text-[10px] text-hull-400 leading-snug">{hull.desc}</div>
                <div className={`mt-1 text-[9px] tracking-[0.2em] ${i === index ? 'text-flare-300' : locked ? 'text-hull-600' : 'text-mint-300'}`}>
                  {i === index ? 'EQUIPPED' : locked ? `${RANKS[i].name.toUpperCase()}` : 'UNLOCKED'}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-hull-600">Career stats live in this browser only. Hulls are cosmetic and never change the odds.</p>
      </div>
    </div>
  );
}
