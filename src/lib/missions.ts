import { BODIES, BODY_ORDER, TourStatus, survivedRoute, type BodyId, type Tour } from './slingshot.ts';
import { dayKey } from './career.ts';

// Daily missions: three per calendar day, seeded by the date so every pilot gets the same set.
// Rewards are XP only; missions never change odds or payouts.

const STORAGE_KEY = 'grand-tour-missions';
export const CLEAR_BONUS_XP = 200;

export type MissionKind = 'survive-body' | 'bank-multiple' | 'fly-tours' | 'chain-assists' | 'variety' | 'grand-tour';

export interface Mission {
  id: string;
  kind: MissionKind;
  param: number;
  target: number;
  progress: number;
  xp: number;
  title: string;
  done: boolean;
}

export interface MissionBoard {
  day: string;
  missions: Mission[];
  /** Bodies survived today, for the variety mission. */
  visited: number[];
  clearedBonus: boolean;
  /** The first tour each day pays a day-streak XP bonus; set once it has. */
  streakBonusPaid?: boolean;
}

const SURVIVE_XP: Record<BodyId, number> = { 4: 40, 0: 40, 5: 50, 6: 60, 1: 70, 7: 90, 2: 120, 3: 200 };
const KIND_WEIGHTS: Array<[MissionKind, number]> = [
  ['survive-body', 3],
  ['bank-multiple', 3],
  ['fly-tours', 3],
  ['chain-assists', 2],
  ['variety', 2],
  ['grand-tour', 1],
];

/** Small deterministic PRNG (FNV-1a seed into mulberry32); cosmetic only. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function makeMission(kind: MissionKind, rand: () => number, day: string): Mission {
  const base = { kind, progress: 0, done: false };
  switch (kind) {
    case 'survive-body': {
      const body = pick(rand, BODY_ORDER);
      return { ...base, id: `${day}-survive-${body}`, param: body, target: 1, xp: SURVIVE_XP[body], title: `Survive a ${BODIES[body].name} slingshot` };
    }
    case 'bank-multiple': {
      const n = pick(rand, [2, 3, 5]);
      return { ...base, id: `${day}-bank-${n}`, param: n, target: 1, xp: n === 2 ? 80 : n === 3 ? 110 : 160, title: `Bank a tour at x${n} or more` };
    }
    case 'fly-tours': {
      const k = pick(rand, [3, 5, 8]);
      return { ...base, id: `${day}-fly-${k}`, param: k, target: k, xp: 20 + 10 * k, title: `Fly ${k} tours` };
    }
    case 'chain-assists': {
      const k = pick(rand, [2, 3]);
      return { ...base, id: `${day}-chain-${k}`, param: k, target: 1, xp: k === 2 ? 90 : 160, title: `Survive ${k} assists in one tour` };
    }
    case 'variety': {
      const k = pick(rand, [3, 4]);
      return { ...base, id: `${day}-variety-${k}`, param: k, target: k, xp: 60 + 20 * k, title: `Survive ${k} different worlds today` };
    }
    case 'grand-tour':
      return { ...base, id: `${day}-grand`, param: 4, target: 1, xp: 300, title: 'Complete a four-leg Grand Tour' };
  }
}

/** The day's three missions, three distinct kinds drawn by weight. */
export function dailyBoard(day = dayKey()): MissionBoard {
  const rand = seeded(`grand-tour:${day}`);
  const pool = [...KIND_WEIGHTS];
  const missions: Mission[] = [];
  while (missions.length < 3) {
    const total = pool.reduce((sum, [, w]) => sum + w, 0);
    let roll = rand() * total;
    const index = pool.findIndex(([, w]) => (roll -= w) < 0);
    const [kind] = pool.splice(index < 0 ? pool.length - 1 : index, 1)[0];
    missions.push(makeMission(kind, rand, day));
  }
  return { day, missions, visited: [], clearedBonus: false };
}

export function loadBoard(today = dayKey()): MissionBoard {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as MissionBoard) : null;
    return saved && saved.day === today && Array.isArray(saved.missions) ? saved : dailyBoard(today);
  } catch (err: unknown) {
    console.warn('Mission board unavailable:', err);
    return dailyBoard(today);
  }
}

function saveBoard(board: MissionBoard) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch (err: unknown) {
    console.warn('Mission board not saved:', err);
  }
}

/**
 * Advance the board with one finished tour. Returns newly completed missions, whether all three
 * just cleared, and whether this was the day's first tour (which pays the day-streak bonus).
 */
export function applyTour(
  board: MissionBoard,
  tour: Tour,
  wager: bigint,
): { board: MissionBoard; completed: Mission[]; cleared: boolean; firstTourToday: boolean } {
  const survived = survivedRoute(tour);
  const visited = [...new Set([...board.visited, ...survived])];
  const completed: Mission[] = [];
  const missions = board.missions.map(mission => {
    if (mission.done) return mission;
    let progress = mission.progress;
    if (mission.kind === 'survive-body' && survived.includes(mission.param as BodyId)) progress = 1;
    if (mission.kind === 'bank-multiple' && tour.payout > 0n && tour.payout >= wager * BigInt(mission.param)) progress = 1;
    if (mission.kind === 'fly-tours') progress += 1;
    if (mission.kind === 'chain-assists' && survived.length >= mission.param) progress = 1;
    if (mission.kind === 'variety') progress = visited.length;
    if (mission.kind === 'grand-tour' && tour.status === TourStatus.COMPLETE) progress = 1;
    const next = { ...mission, progress: Math.min(progress, mission.target), done: progress >= mission.target };
    if (next.done) completed.push(next);
    return next;
  });
  const allDone = missions.every(m => m.done);
  const cleared = allDone && !board.clearedBonus;
  const firstTourToday = !board.streakBonusPaid;
  const next: MissionBoard = { ...board, missions, visited, clearedBonus: board.clearedBonus || allDone, streakBonusPaid: true };
  saveBoard(next);
  return { board: next, completed, cleared, firstTourToday };
}
