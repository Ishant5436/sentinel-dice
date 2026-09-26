import React, { useEffect, useState } from 'react';
import { BODIES, MAX_LEGS, routeMultiplier, routeSurvival, type BodyId } from '../lib/slingshot';
import { paidMultiplier } from '../lib/flight';

// Interactive system map: the four bodies on orbits in 1:2:4:8 harmonics around the launch point,
// with the route drawn as glowing legs colored by the chance of surviving that far.

const W = 340;
const H = 212;
const CX = 170;
const CY = 108;
const TILT = 0.42;
const TAU = Math.PI * 2;
const BODY_IDS: BodyId[] = [0, 1, 2, 3];
// Risk grows with distance from the launch point; `cell` is the sprite sheet cell size.
const ORBITS: Record<BodyId, { rx: number; period: number; phase: number; size: number; cell: number }> = {
  0: { rx: 52, period: 30, phase: 0.9, size: 24, cell: 192 },
  1: { rx: 86, period: 60, phase: 2.6, size: 36, cell: 256 },
  2: { rx: 120, period: 120, phase: 4.3, size: 22, cell: 128 },
  3: { rx: 154, period: 240, phase: 5.6, size: 56, cell: 320 },
};
// Fixed background stars for the map (deterministic so they do not jump between renders).
const MAP_STARS = Array.from({ length: 40 }, (_, i) => ({
  x: (Math.sin(i * 91.7) * 0.5 + 0.5) * W,
  y: (Math.sin(i * 47.3 + 1) * 0.5 + 0.5) * H,
  r: 0.4 + ((i * 7) % 5) * 0.15,
}));
const RISK_BANDS: Array<[string, string]> = [
  ['SAFE', '#34e0a1'],
  ['RISKY', '#facc15'],
  ['BOLD', '#ff8a1f'],
  ['EXTREME', '#ff5d73'],
];

export function riskColor(survival: number) {
  return survival >= 0.5 ? RISK_BANDS[0][1] : survival >= 0.2 ? RISK_BANDS[1][1] : survival >= 0.05 ? RISK_BANDS[2][1] : RISK_BANDS[3][1];
}

/** Escalation ladder after a leg: step up to the next riskier body, then alternate the two riskiest. */
const escalate = (from: BodyId): BodyId => (from < 3 ? ((from + 1) as BodyId) : 2);

const formatGross = (x: number) => (x < 10 ? x.toFixed(2) : x < 1000 ? x.toFixed(1) : x.toFixed(0));
const formatSurvival = (s: number) => (s >= 0.1 ? (s * 100).toFixed(0) : (s * 100).toPrecision(2));

function position(body: BodyId, t: number) {
  const o = ORBITS[body];
  const a = o.phase + (TAU * t) / o.period;
  return { x: CX + o.rx * Math.cos(a), y: CY + o.rx * TILT * Math.sin(a) };
}

/** Orbit clock at ~30 fps; frozen for reduced-motion users. */
function useOrbitClock() {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let lastSet = 0;
    const start = performance.now();
    const tick = (now: number) => {
      if (now - lastSet > 33) {
        lastSet = now;
        setT((now - start) / 1000);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

interface SystemMapProps {
  /** Committed chain: the plan being built, or the legs survived so far. */
  base: BodyId[];
  /** Bodies that can be added next. */
  legal: readonly BodyId[];
  hovered: BodyId | null;
  onHover: (body: BodyId | null) => void;
  onPick: (body: BodyId) => void;
  title: string;
  hint: string;
}

export function SystemMap({ base, legal, hovered, onHover, onPick, title, hint }: SystemMapProps) {
  const t = useOrbitClock();
  const candidate = hovered !== null && legal.includes(hovered) ? hovered : null;
  const solid: BodyId[] = candidate !== null ? [...base, candidate] : base;
  const ghost: BodyId[] = [];
  if (candidate !== null) {
    let last = candidate;
    while (solid.length + ghost.length < MAX_LEGS) {
      last = escalate(last);
      ghost.push(last);
    }
  }
  const full = [...solid, ...ghost];
  const pos = { 0: position(0, t), 1: position(1, t), 2: position(2, t), 3: position(3, t) } as Record<BodyId, { x: number; y: number }>;
  const pairUses = new Map<string, number>();
  const legs = full.map((body, i) => {
    const prevBody = i === 0 ? null : full[i - 1];
    const a = prevBody === null ? { x: CX, y: CY } : pos[prevBody];
    const b = pos[body];
    const route = full.slice(0, i + 1);
    // Out-and-back legs (Pulsar, Black hole, Pulsar, Black hole) share a segment: bow each repeat
    // further out, alternating sides of one canonical perpendicular, so the legs fan apart.
    const pair = prevBody === null ? `home-${body}` : `${Math.min(prevBody, body)}-${Math.max(prevBody, body)}`;
    const uses = pairUses.get(pair) ?? 0;
    pairUses.set(pair, uses + 1);
    const flip = prevBody !== null && prevBody > body ? -1 : 1;
    const dx = (b.x - a.x) * flip;
    const dy = (b.y - a.y) * flip;
    const len = Math.hypot(dx, dy) || 1;
    const bend = (uses % 2 ? -1 : 1) * Math.min(24, len * 0.2) * (1 + Math.floor(uses / 2) * 0.9);
    const qx = (a.x + b.x) / 2 - (dy / len) * bend;
    const qy = (a.y + b.y) / 2 + (dx / len) * bend;
    return {
      i,
      d: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      lx: 0.25 * a.x + 0.5 * qx + 0.25 * b.x,
      ly: 0.25 * a.y + 0.5 * qy + 0.25 * b.y,
      gross: routeMultiplier(route),
      color: riskColor(routeSurvival(route)),
      ghost: i >= solid.length,
    };
  });
  const survival = routeSurvival(solid);

  return (
    <div className="rounded-xl border border-hull-700 bg-hull-900/60 bg-[radial-gradient(ellipse_at_center,rgba(157,92,255,0.14),transparent_70%)] p-2">
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[11px] tracking-[0.3em] text-hull-400">{title}</span>
        <span className="text-[10px] text-hull-600">{hint}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto select-none" role="group" aria-label="System map">
        <defs>
          <radialGradient id="map-home">
            <stop offset="0%" stopColor="#e0f2fe" />
            <stop offset="60%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0)" />
          </radialGradient>
        </defs>
        {MAP_STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="rgba(226, 232, 240, 0.35)" />
        ))}
        {BODY_IDS.map(b => {
          const active = hovered === b || full.includes(b);
          return (
            <ellipse
              key={b}
              cx={CX}
              cy={CY}
              rx={ORBITS[b].rx}
              ry={ORBITS[b].rx * TILT}
              fill="none"
              stroke={active ? 'rgba(255, 201, 138, 0.35)' : 'rgba(185, 179, 218, 0.26)'}
              strokeWidth={active ? 1.2 : 0.8}
              strokeDasharray="2 4"
            />
          );
        })}
        <circle cx={CX} cy={CY} r="10" fill="url(#map-home)" />
        <text x={CX} y={CY + 4} textAnchor="middle" className="fill-hull-950" style={{ fontSize: 5.5, fontWeight: 700, letterSpacing: 0.5 }}>
          GO
        </text>
        {legs.map(leg => (
          <path
            key={`leg-${leg.i}`}
            d={leg.d}
            fill="none"
            stroke={leg.color}
            strokeWidth={leg.ghost ? 1.2 : 2.2}
            strokeOpacity={leg.ghost ? 0.5 : 0.95}
            strokeDasharray={leg.ghost ? '3 4' : '6 5'}
            className="map-flow"
            style={leg.ghost ? undefined : { filter: `drop-shadow(0 0 3px ${leg.color})` }}
          />
        ))}
        {BODY_IDS.map(b => {
          const p = pos[b];
          const o = ORBITS[b];
          const enabled = legal.includes(b);
          const hit = Math.max(o.size / 2, 10) + 3;
          return (
            <g
              key={b}
              role="button"
              tabIndex={enabled ? 0 : -1}
              aria-label={`${BODIES[b].name}${enabled ? '' : ' (not available)'}`}
              aria-disabled={!enabled}
              onMouseEnter={() => onHover(b)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(b)}
              onBlur={() => onHover(null)}
              onClick={() => enabled && onPick(b)}
              onKeyDown={e => {
                if (enabled && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  e.stopPropagation();
                  onPick(b);
                }
              }}
              style={{ cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled || full.includes(b) ? 1 : 0.35, outline: 'none' }}
            >
              {hovered === b && <circle cx={p.x} cy={p.y} r={hit + 3} fill="none" stroke="#ffc98a" strokeWidth="1" strokeDasharray="3 3" />}
              <svg x={p.x - o.size / 2} y={p.y - o.size / 2} width={o.size} height={o.size} viewBox={`0 0 ${o.cell} ${o.cell}`}>
                <image href={`./sprites/${BODIES[b].key}.webp`} width={o.cell * 6} height={o.cell * 6} />
              </svg>
              <circle cx={p.x} cy={p.y} r={hit} fill="transparent" />
              <text x={p.x} y={p.y - Math.max(o.size / 2, 8) - 4} textAnchor="middle" className="fill-hull-300" style={{ fontSize: 7.5, fontWeight: 600 }}>
                {BODIES[b].name.toUpperCase()}
              </text>
            </g>
          );
        })}
        {legs.map(leg => (
          <g key={`chip-${leg.i}`} opacity={leg.ghost ? 0.75 : 1} pointerEvents="none">
            <rect x={leg.lx - 19} y={leg.ly - 7} width="38" height="13" rx="4" fill="#08060f" stroke={leg.color} strokeWidth="0.8" strokeDasharray={leg.ghost ? '2 2' : undefined} />
            <text x={leg.lx} y={leg.ly + 2.6} textAnchor="middle" fill={leg.color} style={{ fontSize: 7.5, fontWeight: 700 }}>
              x{formatGross(leg.gross)}
            </text>
          </g>
        ))}
      </svg>
      <div className="px-1 flex items-center gap-2 text-[10px]">
        {solid.length ? (
          <>
            <span className="text-hull-300 truncate">{solid.map(b => BODIES[b].name).join(' > ')}</span>
            <span className="ml-auto tabular-nums whitespace-nowrap font-semibold" style={{ color: riskColor(survival) }}>
              pays x{paidMultiplier(solid).toFixed(2)} | {formatSurvival(survival)}% survive
            </span>
          </>
        ) : (
          <span className="text-hull-600">Hover a body to trace a route</span>
        )}
      </div>
      <div className="mt-1 px-1 flex items-center gap-2 text-[9px] text-hull-600">
        {RISK_BANDS.map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="w-2.5 h-0.5 rounded" style={{ background: color }} />
            {label}
          </span>
        ))}
        {ghost.length > 0 && <span className="ml-auto">dashed: escalation ladder</span>}
      </div>
    </div>
  );
}
