import { TourStatus, routeMultiplier, survivedRoute, type Tour } from './slingshot';
import { LIGHT_YEARS } from './flight';

// Pilot career kept in this browser only (localStorage). Cosmetic progression; no effect on odds.

const STORAGE_KEY = 'grand-tour-career';

export interface Career {
  tours: number;
  lightYears: number;
  blackHolesSurvived: number;
  topMultiplier: number;
  grandTours: number;
  banks: number;
  badges: string[];
}

export const BADGES = [
  { id: 'escape-velocity', name: 'Escape Velocity', desc: 'First successful bank' },
  { id: 'singularity-survivor', name: 'Singularity Survivor', desc: 'Survived a Black hole slingshot' },
  { id: 'grand-tour-ace', name: 'Grand Tour Ace', desc: 'Completed all four legs' },
  { id: 'top-route', name: 'Top Route Club', desc: 'Flew the x952.32 Grand Tour' },
] as const;

export const RANKS = [
  { name: 'Ensign', min: 0 },
  { name: 'Orbital Navigator', min: 25 },
  { name: 'Deep Space Commander', min: 150 },
  { name: 'Singularity Pioneer', min: 600 },
] as const;

const EMPTY: Career = { tours: 0, lightYears: 0, blackHolesSurvived: 0, topMultiplier: 0, grandTours: 0, banks: 0, badges: [] };

export function rankFor(lightYears: number) {
  let index = 0;
  RANKS.forEach((rank, i) => {
    if (lightYears >= rank.min) index = i;
  });
  const next = RANKS[index + 1];
  const progress = next ? (lightYears - RANKS[index].min) / (next.min - RANKS[index].min) : 1;
  return { rank: RANKS[index], next, progress: Math.min(1, progress) };
}

export function loadCareer(): Career {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<Career>) } : { ...EMPTY };
  } catch (err: unknown) {
    console.warn('Pilot career unavailable:', err);
    return { ...EMPTY };
  }
}

function saveCareer(career: Career) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(career));
  } catch (err: unknown) {
    console.warn('Pilot career not saved:', err);
  }
}

/** Fold one finished tour into the career. Returns the new career and any badges it unlocked. */
export function recordTour(career: Career, tour: Tour, wager: bigint): { career: Career; unlocked: string[] } {
  const survived = survivedRoute(tour);
  const banked = tour.payout > 0n;
  const complete = tour.status === TourStatus.COMPLETE;
  const multiple = banked && wager > 0n ? Number((tour.payout * 10000n) / wager) / 10000 : 0;
  const next: Career = {
    tours: career.tours + 1,
    lightYears: Math.round((career.lightYears + survived.reduce<number>((ly, b) => ly + LIGHT_YEARS[b], 0)) * 10) / 10,
    blackHolesSurvived: career.blackHolesSurvived + survived.filter(b => b === 3).length,
    topMultiplier: Math.max(career.topMultiplier, multiple),
    grandTours: career.grandTours + (complete ? 1 : 0),
    banks: career.banks + (banked ? 1 : 0),
    badges: [...career.badges],
  };
  const earned = [
    banked && 'escape-velocity',
    survived.includes(3) && 'singularity-survivor',
    complete && 'grand-tour-ace',
    complete && routeMultiplier(survived) === 1024 && 'top-route',
  ].filter((id): id is string => typeof id === 'string' && !next.badges.includes(id));
  next.badges.push(...earned);
  saveCareer(next);
  return { career: next, unlocked: earned };
}
