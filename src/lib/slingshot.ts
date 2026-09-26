import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters, type Hex } from 'viem';

// Grand Tour paytable and state machine, mirroring contracts/GravitySlingshot.sol exactly.
// The standalone demo, the host integration and scripts/monte-carlo.ts all use this module.

export type BodyId = 0 | 1 | 2 | 3;

export interface Body {
  id: BodyId;
  key: 'moon' | 'jupiter' | 'pulsar' | 'blackhole';
  name: string;
  surviveBps: number;
  multNum: bigint;
  multDen: bigint;
  multLabel: string;
  blurb: string;
}

export const BODIES: readonly Body[] = [
  { id: 0, key: 'moon', name: 'Moon', surviveBps: 8000, multNum: 5n, multDen: 4n, multLabel: '1.25x', blurb: 'Gentle assist' },
  { id: 1, key: 'jupiter', name: 'Jupiter', surviveBps: 5000, multNum: 2n, multDen: 1n, multLabel: '2x', blurb: 'Gas giant' },
  { id: 2, key: 'pulsar', name: 'Pulsar', surviveBps: 2500, multNum: 4n, multDen: 1n, multLabel: '4x', blurb: 'Neutron star' },
  { id: 3, key: 'blackhole', name: 'Black hole', surviveBps: 1250, multNum: 8n, multDen: 1n, multLabel: '8x', blurb: 'Event horizon' },
];

export const MAX_LEGS = 4;
export const NO_BODY = 255;
export const RTP_BPS = 9800n;
export const BASIS_POINTS = 10000n;
export const ACTION_LAUNCH = 1;
export const ACTION_EJECT = 2;

export const TourStatus = {
  CRUISING: 0, // survived the last leg, player to act
  BURNING: 1, // leg launched, waiting for VRF
  CAPTURED: 2,
  EJECTED: 3,
  COMPLETE: 4,
} as const;
export type TourStatusCode = (typeof TourStatus)[keyof typeof TourStatus];

export interface Tour {
  status: TourStatusCode;
  legs: number; // legs launched, the pending one included
  route: number[]; // length 4, NO_BODY when unused
  rolls: number[]; // length 4, roll in [0, 9999] per resolved leg
  payout: bigint;
}

const TOUR_ABI = parseAbiParameters('uint8 status, uint8 legs, uint8[4] route, uint16[4] rolls, uint256 payout');

export function encodeGameData(firstBody: BodyId): Hex {
  return encodeAbiParameters(parseAbiParameters('uint8 firstBody'), [firstBody]);
}

export function decodeGameData(data: Hex): BodyId | null {
  try {
    const [body] = decodeAbiParameters(parseAbiParameters('uint8 firstBody'), data);
    return body < BODIES.length ? (body as BodyId) : null;
  } catch (err: unknown) {
    console.warn('Unreadable gameData:', err);
    return null;
  }
}

export function encodeLaunch(body: BodyId): Hex {
  return encodeAbiParameters(parseAbiParameters('uint8 action, uint8 body'), [ACTION_LAUNCH, body]);
}

export function encodeEject(): Hex {
  return encodeAbiParameters(parseAbiParameters('uint8 action, uint8 body'), [ACTION_EJECT, 0]);
}

export function decodeTour(state: Hex | undefined): Tour | null {
  if (!state || state === '0x') return null;
  try {
    const [status, legs, route, rolls, payout] = decodeAbiParameters(TOUR_ABI, state);
    return { status: status as TourStatusCode, legs, route: [...route], rolls: [...rolls], payout };
  } catch (err: unknown) {
    console.warn('Unreadable tour state:', err);
    return null;
  }
}

/** Bodies flown so far (resolved legs plus the one in flight). */
export function flownRoute(tour: Tour): BodyId[] {
  return tour.route.slice(0, tour.legs) as BodyId[];
}

/** Resolved legs only: while burning, the last launched leg has no result yet. */
export function survivedRoute(tour: Tour): BodyId[] {
  const flown = flownRoute(tour);
  if (tour.status === TourStatus.BURNING || tour.status === TourStatus.CAPTURED) return flown.slice(0, -1);
  return flown;
}

export function routeFraction(route: readonly number[]): [bigint, bigint] {
  return route.reduce<[bigint, bigint]>(
    ([num, den], body) => [num * BODIES[body].multNum, den * BODIES[body].multDen],
    [1n, 1n]
  );
}

/** Gross tour multiplier (before the 2% edge), for display. */
export function routeMultiplier(route: readonly number[]): number {
  const [num, den] = routeFraction(route);
  return Number(num) / Number(den);
}

/** The contract's single payout function: wager * product * 0.98, one floor division. */
export function tourPayout(wager: bigint, route: readonly number[]): bigint {
  if (route.length === 0) return 0n;
  const [num, den] = routeFraction(route);
  return (wager * num * RTP_BPS) / (den * BASIS_POINTS);
}

export function topRoute(firstBody: BodyId): BodyId[] {
  if (firstBody === 0) return [0, 3, 2, 3];
  if (firstBody === 1) return [1, 3, 2, 3];
  if (firstBody === 2) return [2, 3, 2, 3];
  return [3, 2, 3, 2];
}

/** Worst-case payout multiplier for a tour opened on `firstBody` (313.6x up to 1003.52x). */
export function maxPayoutMultiplier(firstBody: BodyId): number {
  return (routeMultiplier(topRoute(firstBody)) * Number(RTP_BPS)) / Number(BASIS_POINTS);
}

/** P(surviving every leg of the route), as a fraction in [0, 1]. */
export function routeSurvival(route: readonly number[]): number {
  return route.reduce((p, body) => p * (BODIES[body].surviveBps / 10000), 1);
}

/** Bodies the probe may assist around next: any body except the one it is leaving. */
export function legalNextBodies(tour: Tour): BodyId[] {
  if (tour.status !== TourStatus.CRUISING || tour.legs >= MAX_LEGS) return [];
  const leaving = tour.route[tour.legs - 1];
  return BODIES.map(b => b.id).filter(id => id !== leaving);
}

// ---------------------------------------------------------------------------
// State transitions (same rules as onSessionStart / onPlayerAction / onRandomness)
// ---------------------------------------------------------------------------

export function startTour(firstBody: BodyId): Tour {
  return {
    status: TourStatus.BURNING,
    legs: 1,
    route: [firstBody, NO_BODY, NO_BODY, NO_BODY],
    rolls: [0, 0, 0, 0],
    payout: 0n,
  };
}

export function launchLeg(tour: Tour, body: BodyId): Tour {
  if (!legalNextBodies(tour).includes(body)) throw new Error(`Illegal launch to body ${body}`);
  const route = [...tour.route];
  route[tour.legs] = body;
  return { ...tour, route, legs: tour.legs + 1, status: TourStatus.BURNING };
}

export function ejectTour(tour: Tour, wager: bigint): Tour {
  if (tour.status !== TourStatus.CRUISING) throw new Error('Can only eject while cruising');
  return { ...tour, status: TourStatus.EJECTED, payout: tourPayout(wager, flownRoute(tour)) };
}

export function resolveLeg(tour: Tour, roll: number, wager: bigint): Tour {
  if (tour.status !== TourStatus.BURNING) throw new Error('No leg in flight');
  const leg = tour.legs - 1;
  const rolls = [...tour.rolls];
  rolls[leg] = roll;
  if (roll >= BODIES[tour.route[leg]].surviveBps) return { ...tour, rolls, status: TourStatus.CAPTURED };
  if (tour.legs === MAX_LEGS) {
    return { ...tour, rolls, status: TourStatus.COMPLETE, payout: tourPayout(wager, flownRoute(tour)) };
  }
  return { ...tour, rolls, status: TourStatus.CRUISING };
}

/** Unbiased roll in [0, 9999] from the Web Crypto CSPRNG, by rejection sampling. */
export function rollUniformBps(): number {
  const limit = Math.floor(0x1_0000_0000 / 10000) * 10000;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % 10000;
  }
}
