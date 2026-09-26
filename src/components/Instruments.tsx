import React, { useId, useMemo } from 'react';
import { LIGHT_SPEED_KMS, formatSpeed } from '../lib/flight';

// Analog cockpit dials and the optional CRT treatment for the flight scene.

const START_DEG = -120;
const SWEEP_DEG = 240;
const CX = 56;
const CY = 56;

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function arc(r: number, f0: number, f1: number) {
  const d0 = START_DEG + SWEEP_DEG * f0;
  const d1 = START_DEG + SWEEP_DEG * f1;
  const [x0, y0] = polar(r, d0);
  const [x1, y1] = polar(r, d1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

type ZoneTone = 'warn' | 'danger' | 'relativistic';
const ZONE_COLOR: Record<ZoneTone, string> = { warn: '#facc15', danger: '#ff5d73', relativistic: '#bf8cff' };

interface DialProps {
  label: string;
  frac: number;
  readout: string;
  ticks: Array<{ frac: number; label?: string }>;
  zones: Array<{ from: number; to: number; tone: ZoneTone }>;
  /** Strobe the hatched zones: the needle is nearing or inside them. */
  alarm: boolean;
}

function Dial({ label, frac, readout, ticks, zones, alarm }: DialProps) {
  const id = useId().replace(/:/g, '');
  const angle = START_DEG + SWEEP_DEG * Math.max(0, Math.min(1, frac));
  return (
    <svg viewBox="0 0 112 100" className="w-[104px] h-[93px]" role="img" aria-label={`${label} ${readout}`}>
      <defs>
        {(Object.keys(ZONE_COLOR) as ZoneTone[]).map(tone => (
          <pattern key={tone} id={`${id}-${tone}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="2" height="4" fill={ZONE_COLOR[tone]} />
          </pattern>
        ))}
        <radialGradient id={`${id}-face`} cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#1d1838" />
          <stop offset="100%" stopColor="#08060f" />
        </radialGradient>
      </defs>
      <circle cx={CX} cy={CY} r="50" fill={`url(#${id}-face)`} stroke="rgba(125, 211, 252, 0.35)" strokeWidth="1" />
      <path d={arc(44, 0, 1)} fill="none" stroke="rgba(185, 179, 218, 0.18)" strokeWidth="6" />
      {zones.map(zone => (
        <path
          key={zone.tone}
          d={arc(44, zone.from, zone.to)}
          fill="none"
          stroke={`url(#${id}-${zone.tone})`}
          strokeWidth="6"
          className={alarm && zone.tone !== 'relativistic' ? 'animate-strobe' : ''}
        />
      ))}
      {ticks.map(tick => {
        const deg = START_DEG + SWEEP_DEG * tick.frac;
        const [x0, y0] = polar(40, deg);
        const [x1, y1] = polar(tick.label ? 34 : 37, deg);
        const [lx, ly] = polar(26, deg);
        return (
          <g key={tick.frac}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="rgba(226, 232, 240, 0.7)" strokeWidth={tick.label ? 1.4 : 0.8} />
            {tick.label && (
              <text x={lx} y={ly + 2.5} textAnchor="middle" className="fill-hull-400" style={{ fontSize: 7, fontWeight: 600 }}>
                {tick.label}
              </text>
            )}
          </g>
        );
      })}
      <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: 'transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <line x1={CX} y1={CY + 6} x2={CX} y2={CY - 40} stroke="#ffab4d" strokeWidth="2" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 3px #ff8a1f)' }} />
      </g>
      <circle cx={CX} cy={CY} r="4" fill="#2b2450" stroke="#ffc98a" strokeWidth="1" />
      <text x={CX} y={CY + 22} textAnchor="middle" className={alarm ? 'fill-ember-300' : 'fill-hull-100'} style={{ fontSize: 10, fontWeight: 700 }}>
        {readout}
      </text>
      <text x={CX} y={CY + 33} textAnchor="middle" className="fill-cyan-300" style={{ fontSize: 6.5, letterSpacing: 1.5 }}>
        {label}
      </text>
    </svg>
  );
}

// Velocity dial is logarithmic from 3 km/s to 300,000 km/s so Moon and 0.8c both read clearly.
const V_MIN = Math.log10(3);
const V_MAX = Math.log10(300_000);
const vFrac = (kms: number) => (Math.log10(Math.max(3, kms)) - V_MIN) / (V_MAX - V_MIN);
const VELOCITY_TICKS = [10, 100, 1_000, 10_000, 100_000].map((v, i) => ({ frac: vFrac(v), label: ['10', '100', '1k', '10k', '100k'][i] }));
const VELOCITY_ZONES = [{ from: vFrac(0.1 * LIGHT_SPEED_KMS), to: 1, tone: 'relativistic' as const }];

// G dial uses a square-root scale up to 500 G; hatched warning from 100 G, red line from 250 G.
const G_MAX = 500;
const gFrac = (g: number) => Math.sqrt(Math.max(0, g) / G_MAX);
const G_TICKS = [0, 10, 50, 100, 200, 300, 500].map(g => ({ frac: gFrac(g), label: g === 10 || g === 300 ? undefined : String(g) }));
const G_ZONES = [
  { from: gFrac(100), to: gFrac(250), tone: 'warn' as const },
  { from: gFrac(250), to: 1, tone: 'danger' as const },
];
const G_ALARM = 80;

export function FlightGauges({ velocityKms, g }: { velocityKms: number; g: number }) {
  return (
    <div className="flex gap-1">
      <Dial label="VELOCITY" frac={vFrac(velocityKms)} readout={formatSpeed(velocityKms)} ticks={VELOCITY_TICKS} zones={VELOCITY_ZONES} alarm={false} />
      <Dial label="G-LOAD" frac={gFrac(g)} readout={`${g.toFixed(1)} G`} ticks={G_TICKS} zones={G_ZONES} alarm={g >= G_ALARM} />
    </div>
  );
}

/** Barrel-distortion map for feDisplacementMap: red/green encode an outward pull that grows with r^2. */
function barrelMap(size = 128): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / (size - 1)) * 2 - 1;
      const v = (y / (size - 1)) * 2 - 1;
      const r2 = (u * u + v * v) / 2;
      const i = (y * size + x) * 4;
      img.data[i] = Math.round(128 + 127 * u * r2);
      img.data[i + 1] = Math.round(128 + 127 * v * r2);
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

export const CRT_FILTER_ID = 'grand-tour-crt';

/**
 * CRT phosphor treatment: SVG filter (0.8 px red/blue channel split plus barrel curvature),
 * scanlines, a rolling refresh band and vignette. The scene wrapper opts in with
 * style={{ filter: `url(#${CRT_FILTER_ID})` }}.
 */
export function CrtLayer({ on }: { on: boolean }) {
  const map = useMemo(() => (on ? barrelMap() : ''), [on]);
  if (!on) return null;
  return (
    <>
      <svg width="0" height="0" className="absolute" aria-hidden>
        <filter id={CRT_FILTER_ID} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feImage href={map} x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="barrel" />
          <feDisplacementMap in="SourceGraphic" in2="barrel" scale="18" xChannelSelector="R" yChannelSelector="G" result="curved" />
          <feColorMatrix in="curved" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red" />
          <feOffset in="red" dx="0.8" result="redShift" />
          <feColorMatrix in="curved" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green" />
          <feColorMatrix in="curved" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue" />
          <feOffset in="blue" dx="-0.8" result="blueShift" />
          <feBlend in="redShift" in2="green" mode="screen" result="redGreen" />
          <feBlend in="redGreen" in2="blueShift" mode="screen" />
        </filter>
      </svg>
      <div className="crt-scanlines pointer-events-none absolute inset-0 z-20" aria-hidden />
    </>
  );
}
