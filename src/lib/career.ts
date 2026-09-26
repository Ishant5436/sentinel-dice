import { BODY_ORDER, TourStatus, routeMultiplier, survivedRoute, type BodyId, type Tour } from './slingshot.ts';
import { LIGHT_YEARS } from './flight.ts';

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
  /** Pilot XP: every tour earns some, riskier survived legs earn more, missions add bonuses. */
  xp: number;
  /** Bodies survived at least once: the galaxy codex. */
  discovered: number[];
  /** Consecutive tours that banked a payout, and the best such run. */
  winStreak: number;
  bestWinStreak: number;
  /** Consecutive calendar days with at least one visit, and the last day seen (YYYY-MM-DD). */
  dayStreak: number;
  lastDay: string;
}

export const BADGES = [
  { id: 'escape-velocity', name: 'Escape Velocity', desc: 'First successful bank' },
  { id: 'singularity-survivor', name: 'Singularity Survivor', desc: 'Survived a Black hole slingshot' },
  { id: 'grand-tour-ace', name: 'Grand Tour Ace', desc: 'Completed all four legs' },
  { id: 'top-route', name: 'Top Route Club', desc: 'Flew the x952.32 Grand Tour' },
  { id: 'galaxy-explorer', name: 'Galaxy Explorer', desc: 'Survived all eight worlds' },
  { id: 'hot-streak', name: 'Hot Streak', desc: 'Banked five tours in a row' },
] as const;

export const RANKS = [
  { name: 'Ensign', min: 0 },
  { name: 'Orbital Navigator', min: 25 },
  { name: 'Deep Space Commander', min: 150 },
  { name: 'Singularity Pioneer', min: 600 },
] as const;

/** Probe hull unlocked at each rank, drawn by components/canvas/craft.ts (same index as RANKS). */
export const CHASSIS = [
  { name: 'Pioneer', desc: 'Gold-foil deep space probe' },
  { name: 'Survey Craft', desc: 'Dual ion engines, blue exhaust' },
  { name: 'Lancer', desc: 'Heavy hull, wide solar arrays' },
  { name: 'Tachyon Orbiter', desc: 'Shielded stealth hull, antimatter plume' },
] as const;
export type ChassisId = 0 | 1 | 2 | 3;

/** XP for surviving one assist around each body: riskier bodies are worth more. */
export const LEG_XP: Record<BodyId, number> = { 4: 5, 0: 6, 5: 8, 6: 10, 1: 12, 7: 16, 2: 24, 3: 40 };
const TOUR_XP = 10;
const BANK_XP = 10;
const GRAND_TOUR_XP = 50;

const EMPTY: Career = {
  tours: 0,
  lightYears: 0,
  blackHolesSurvived: 0,
  topMultiplier: 0,
  grandTours: 0,
  banks: 0,
  badges: [],
  xp: 0,
  discovered: [],
  winStreak: 0,
  bestWinStreak: 0,
  dayStreak: 0,
  lastDay: '',
};

export function rankFor(lightYears: number) {
  let index = 0;
  RANKS.forEach((rank, i) => {
    if (lightYears >= rank.min) index = i;
  });
  const next = RANKS[index + 1];
  const progress = next ? (lightYears - RANKS[index].min) / (next.min - RANKS[index].min) : 1;
  return { rank: RANKS[index], index: index as ChassisId, next, progress: Math.min(1, progress) };
}

/** Level n starts at 50 * n * (n - 1) XP: level 2 at 100, 3 at 300, 4 at 600, 5 at 1000. */
export function levelFor(xp: number) {
  const level = Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2));
  const start = 50 * level * (level - 1);
  const end = 50 * (level + 1) * level;
  return { level, into: xp - start, span: end - start, progress: Math.min(1, (xp - start) / (end - start)) };
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

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(date = new Date()): string {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

/** Count today's visit: continues the day streak from yesterday, otherwise restarts it at 1. */
export function touchDay(career: Career, today = dayKey()): Career {
  if (career.lastDay === today) return career;
  const next = { ...career, dayStreak: career.lastDay === previousDay(today) ? career.dayStreak + 1 : 1, lastDay: today };
  saveCareer(next);
  return next;
}

export function addXp(career: Career, xp: number): Career {
  const next = { ...career, xp: career.xp + xp };
  saveCareer(next);
  return next;
}

export interface TourRecord {
  career: Career;
  /** Badge ids earned by this tour. */
  unlocked: string[];
  /** Bodies survived for the first time on this tour. */
  discoveries: BodyId[];
  xpGained: number;
  /** New level reached, or null. */
  levelUp: number | null;
}

/** Fold one finished tour into the career. */
export function recordTour(career: Career, tour: Tour, wager: bigint): TourRecord {
  const survived = survivedRoute(tour);
  const banked = tour.payout > 0n;
  const complete = tour.status === TourStatus.COMPLETE;
  const multiple = banked && wager > 0n ? Number((tour.payout * 10000n) / wager) / 10000 : 0;
  const discoveries = [...new Set(survived)].filter(b => !career.discovered.includes(b));
  const xpGained =
    TOUR_XP + survived.reduce<number>((xp, b) => xp + LEG_XP[b], 0) + (banked ? BANK_XP : 0) + (complete ? GRAND_TOUR_XP : 0);
  const winStreak = banked ? career.winStreak + 1 : 0;
  const next: Career = {
    ...career,
    tours: career.tours + 1,
    lightYears: Math.round((career.lightYears + survived.reduce<number>((ly, b) => ly + LIGHT_YEARS[b], 0)) * 10) / 10,
    blackHolesSurvived: career.blackHolesSurvived + survived.filter(b => b === 3).length,
    topMultiplier: Math.max(career.topMultiplier, multiple),
    grandTours: career.grandTours + (complete ? 1 : 0),
    banks: career.banks + (banked ? 1 : 0),
    badges: [...career.badges],
    xp: career.xp + xpGained,
    discovered: [...career.discovered, ...discoveries],
    winStreak,
    bestWinStreak: Math.max(career.bestWinStreak, winStreak),
  };
  const earned = [
    banked && 'escape-velocity',
    survived.includes(3) && 'singularity-survivor',
    complete && 'grand-tour-ace',
    complete && routeMultiplier(survived) === 1024 && 'top-route',
    BODY_ORDER.every(b => next.discovered.includes(b)) && 'galaxy-explorer',
    winStreak >= 5 && 'hot-streak',
  ].filter((id): id is string => typeof id === 'string' && !next.badges.includes(id));
  next.badges.push(...earned);
  saveCareer(next);
  const before = levelFor(career.xp).level;
  const after = levelFor(next.xp).level;
  return { career: next, unlocked: earned, discoveries, xpGained, levelUp: after > before ? after : null };
}
