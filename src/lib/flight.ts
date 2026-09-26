import { BASIS_POINTS, RTP_BPS, routeMultiplier, routeSurvival, type BodyId } from './slingshot';

// Flavor and planning helpers layered on the paytable. Nothing here affects outcomes.

export interface RoutePreset {
  name: string;
  route: BodyId[];
}

/** Legal routes only: the probe can never slingshot the body it just left. */
export const ROUTE_PRESETS: RoutePreset[] = [
  { name: 'Lunar Express', route: [0, 1, 0, 1] },
  { name: 'Gas Giant Hop', route: [1, 2] },
  { name: 'Grand Tour Max', route: [2, 3, 2, 3] },
];

/** Multiplier actually paid for a route (after the house edge). */
export const paidMultiplier = (route: readonly number[]) => (routeMultiplier(route) * Number(RTP_BPS)) / Number(BASIS_POINTS);

export const presetSummary = (route: readonly number[]) =>
  `x${paidMultiplier(route).toFixed(2)} | ${(routeSurvival(route) * 100).toPrecision(route.length > 3 ? 2 : 3)}% survive`;

const CALLSIGNS: Record<BodyId, string[]> = {
  0: ['SELENE', 'ARTEMIS', 'LUNA'],
  1: ['JUNO', 'GALILEO', 'VOYAGER'],
  2: ['PULSAR DART', 'BEACON', 'HELIOS'],
  3: ['EVENT HORIZON', 'GARGANTUA', 'SINGULARITY'],
};
const ROMAN = ['I', 'II', 'III', 'IV'];

/** Deterministic mission name: the riskiest body picks the family, the route picks the name. */
export function missionDesignation(route: readonly number[]): string {
  if (route.length === 0) return 'AWAITING FLIGHT PLAN';
  const riskiest = Math.max(...route) as BodyId;
  const hash = route.reduce((h, b) => h * 5 + b + 1, 7);
  const names = CALLSIGNS[riskiest];
  const suffix = route.length === 4 && riskiest === 3 ? 'X' : ROMAN[route.length - 1];
  return `${names[hash % names.length]}-${suffix}`;
}

export const G_LOAD: Record<BodyId, number> = { 0: 1.2, 1: 24.8, 2: 186.0, 3: 450.0 };
const PERIAPSIS_ALTITUDE: Record<BodyId, string> = { 0: '110 km', 1: '4,200 km', 2: '38 km', 3: '1.5 Rs' };
export const LIGHT_YEARS: Record<BodyId, number> = { 0: 1.3, 1: 4.2, 2: 12.7, 3: 27.0 };

export type TelemetryPhase = 'idle' | 'approach' | 'periapsis' | 'coast';

export interface Telemetry {
  velocity: string;
  gLoad: string;
  altitude: string;
}

/** Cosmetic flight telemetry. Velocity grows with the tour multiplier; g-load peaks at periapsis. */
export function telemetry(body: BodyId, grossMultiplier: number, phase: TelemetryPhase, jitter = 0): Telemetry {
  const velocity = 11.2 * grossMultiplier ** 0.75;
  const g = phase === 'periapsis' ? G_LOAD[body] * (1 + jitter * 0.04) : phase === 'approach' ? G_LOAD[body] * 0.35 : 0;
  const altitude = phase === 'periapsis' ? PERIAPSIS_ALTITUDE[body] : phase === 'approach' ? 'closing' : phase === 'coast' ? 'escape arc' : '--';
  return { velocity: `${velocity.toFixed(1)} km/s`, gLoad: `${g.toFixed(1)} G`, altitude };
}
