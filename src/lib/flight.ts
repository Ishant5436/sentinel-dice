import { BASIS_POINTS, BODIES, RTP_BPS, routeMultiplier, routeSurvival, type BodyId } from './slingshot.ts';

// Flavor and planning helpers layered on the paytable. Nothing here affects outcomes.

export interface RoutePreset {
  name: string;
  route: BodyId[];
}

/** Legal routes only: the probe can never slingshot the body it just left. */
export const ROUTE_PRESETS: RoutePreset[] = [
  { name: 'Comet Cruise', route: [4, 0, 4, 0] },
  { name: 'Lunar Express', route: [0, 1, 0, 1] },
  { name: 'Ring Runner', route: [6, 1, 6, 1] },
  { name: 'Gas Giant Hop', route: [1, 2] },
  { name: 'Stellar Forge', route: [7, 2, 7] },
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
  4: ['HALLEY', 'ROSETTA', 'GIOTTO'],
  5: ['TRITON', 'TRIDENT', 'NEREID'],
  6: ['CASSINI', 'HUYGENS', 'TITAN'],
  7: ['BETELGEUSE', 'ANTARES', 'ALDEBARAN'],
};
const ROMAN = ['I', 'II', 'III', 'IV'];

/** Deterministic mission name: the riskiest body picks the family, the route picks the name. */
export function missionDesignation(route: readonly number[]): string {
  if (route.length === 0) return 'AWAITING FLIGHT PLAN';
  // Riskiest = lowest survival chance (ids are not in risk order).
  const riskiest = route.reduce((worst, b) => (BODIES[b].surviveBps < BODIES[worst].surviveBps ? b : worst), route[0]) as BodyId;
  const hash = route.reduce((h, b) => h * 5 + b + 1, 7);
  const names = CALLSIGNS[riskiest];
  const suffix = route.length === 4 && riskiest === 3 ? 'X' : ROMAN[route.length - 1];
  return `${names[hash % names.length]}-${suffix}`;
}

/** Galaxy codex entry unlocked the first time a pilot survives each world. */
export const CODEX: Record<BodyId, string> = {
  4: 'A dirty snowball of ice and dust. Its tails always point away from the star.',
  0: 'Our Moon keeps the same face turned toward Earth.',
  5: 'Winds on Neptune reach about 2,100 km/h, the fastest measured on any planet.',
  6: 'Saturn\'s rings are mostly water ice, yet in places only tens of metres thick.',
  1: 'The Great Red Spot is a storm wider than Earth that has raged for centuries.',
  7: 'A dying star, swollen hundreds of times wider than the Sun.',
  2: 'A city-sized neutron star that can spin hundreds of times a second.',
  3: 'Past the event horizon, not even light can escape.',
};

export const G_LOAD: Record<BodyId, number> = { 0: 1.2, 1: 24.8, 2: 186.0, 3: 450.0, 4: 0.3, 5: 14.5, 6: 18.6, 7: 96.0 };
/** Periapsis speed per body in km/s; the Black hole slingshot runs at 0.8c. */
export const PERIAPSIS_SPEED: Record<BodyId, number> = { 0: 11.2, 1: 44.8, 2: 112.5, 3: 240_000, 4: 8.2, 5: 23.5, 6: 35.5, 7: 68.0 };
export const LIGHT_SPEED_KMS = 299_792;
const PARKING_SPEED = 7.8;
const PERIAPSIS_ALTITUDE: Record<BodyId, string> = {
  0: '110 km',
  1: '4,200 km',
  2: '38 km',
  3: '1.5 Rs',
  4: '2 km',
  5: '1,000 km',
  6: 'ring plane',
  7: '0.2 AU',
};
export const LIGHT_YEARS: Record<BodyId, number> = { 0: 1.3, 1: 4.2, 2: 12.7, 3: 27.0, 4: 0.8, 5: 2.6, 6: 3.4, 7: 8.5 };

export type TelemetryPhase = 'idle' | 'approach' | 'periapsis' | 'coast' | 'lost';

export interface Telemetry {
  velocityKms: number;
  g: number;
  velocity: string;
  gLoad: string;
  altitude: string;
}

export const formatSpeed = (kms: number) =>
  kms >= 10_000 ? `${(kms / LIGHT_SPEED_KMS).toFixed(2)}c` : `${kms.toFixed(1)} km/s`;

/** Cosmetic flight telemetry: speed and g-load peak at periapsis, the probe keeps most of its speed on the escape arc. */
export function telemetry(body: BodyId, phase: TelemetryPhase, jitter = 0): Telemetry {
  const peak = PERIAPSIS_SPEED[body];
  const velocityKms =
    phase === 'periapsis'
      ? peak * (1 + jitter * 0.01)
      : phase === 'approach'
        ? peak * 0.35
        : phase === 'coast'
          ? peak * 0.75
          : phase === 'lost'
            ? 0
            : PARKING_SPEED;
  const g = phase === 'periapsis' ? G_LOAD[body] * (1 + jitter * 0.04) : phase === 'approach' ? G_LOAD[body] * 0.35 : 0;
  const altitude =
    phase === 'periapsis' ? PERIAPSIS_ALTITUDE[body] : phase === 'approach' ? 'closing' : phase === 'coast' ? 'escape arc' : phase === 'lost' ? 'signal lost' : '--';
  return { velocityKms, g, velocity: formatSpeed(velocityKms), gLoad: `${g.toFixed(1)} G`, altitude };
}
