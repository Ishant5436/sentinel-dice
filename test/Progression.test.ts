import { expect } from "chai";
import { TourStatus, NO_BODY, type Tour } from "../src/lib/slingshot.ts";
import { levelFor, loadCareer, recordTour, touchDay } from "../src/lib/career.ts";
import { applyTour, dailyBoard } from "../src/lib/missions.ts";
import { missionDesignation } from "../src/lib/flight.ts";

// White-box tests for the cosmetic progression layer (no chain, no odds involved).
describe("Progression: levels, streaks, missions, codex", () => {
  const WAGER = 10n ** 18n;

  before(() => {
    // career.ts and missions.ts persist to localStorage; give Node an in-memory one.
    const store = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    };
  });

  const tour = (status: number, route: number[], payout = 0n): Tour => ({
    status: status as Tour["status"],
    legs: route.length,
    route: [...route, NO_BODY, NO_BODY, NO_BODY, NO_BODY].slice(0, 4),
    rolls: [0, 0, 0, 0],
    payout,
  });

  it("levels start at 50 n (n - 1) XP", () => {
    for (const [xp, level] of [[0, 1], [99, 1], [100, 2], [299, 2], [300, 3], [599, 3], [600, 4], [1000, 5]]) {
      expect(levelFor(xp).level, `xp ${xp}`).to.equal(level);
    }
    expect(levelFor(150).progress).to.be.closeTo(0.25, 1e-9);
  });

  it("the day streak continues from yesterday and resets after a gap", () => {
    const base = { ...loadCareer(), dayStreak: 4, lastDay: "2026-09-25" };
    expect(touchDay(base, "2026-09-25")).to.equal(base);
    expect(touchDay(base, "2026-09-26").dayStreak).to.equal(5);
    expect(touchDay(base, "2026-09-28").dayStreak).to.equal(1);
    expect(touchDay({ ...base, lastDay: "2026-09-30" }, "2026-10-01").dayStreak).to.equal(5); // month rollover
  });

  it("daily boards are deterministic per day with three distinct mission kinds", () => {
    const a = dailyBoard("2026-09-26");
    const b = dailyBoard("2026-09-26");
    expect(a).to.deep.equal(b);
    expect(new Set(a.missions.map(m => m.kind)).size).to.equal(3);
    const days = ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"].map(d => JSON.stringify(dailyBoard(d).missions.map(m => m.id.slice(11))));
    expect(new Set(days).size).to.be.greaterThan(1);
  });

  it("missions progress once, pay once, and flag only the day's first tour", () => {
    const board = {
      ...dailyBoard("2026-09-26"),
      missions: [
        { id: "a", kind: "fly-tours" as const, param: 2, target: 2, progress: 0, xp: 40, title: "Fly 2 tours", done: false },
        { id: "b", kind: "survive-body" as const, param: 6, target: 1, progress: 0, xp: 60, title: "Survive Saturn", done: false },
        { id: "c", kind: "bank-multiple" as const, param: 2, target: 1, progress: 0, xp: 80, title: "Bank x2", done: false },
      ],
    };
    const first = applyTour(board, tour(TourStatus.CAPTURED, [6, 1]), WAGER); // survived Saturn, lost at Jupiter
    expect(first.firstTourToday).to.equal(true);
    expect(first.completed.map(m => m.id)).to.deep.equal(["b"]);
    expect(first.board.missions[0].progress).to.equal(1);
    const second = applyTour(first.board, tour(TourStatus.EJECTED, [1], (WAGER * 186n) / 100n), WAGER); // x1.86 is not x2
    expect(second.firstTourToday).to.equal(false);
    expect(second.completed.map(m => m.id)).to.deep.equal(["a"]);
    expect(second.cleared).to.equal(false);
    const third = applyTour(second.board, tour(TourStatus.EJECTED, [6, 1], (WAGER * 2976n) / 1000n), WAGER);
    expect(third.completed.map(m => m.id)).to.deep.equal(["c"]);
    expect(third.cleared).to.equal(true);
    const fourth = applyTour(third.board, tour(TourStatus.EJECTED, [6, 1], WAGER * 3n), WAGER);
    expect(fourth.completed).to.deep.equal([]);
    expect(fourth.cleared).to.equal(false); // the clear bonus pays once per day
  });

  it("recordTour: XP by risk, discoveries once, streak reset on capture, explorer badge", () => {
    let career = { ...loadCareer(), xp: 0, discovered: [], badges: [], winStreak: 0 };
    const banked = recordTour(career, tour(TourStatus.EJECTED, [2, 3], WAGER * 29n), WAGER);
    expect(banked.xpGained).to.equal(10 + 24 + 40 + 10);
    expect(banked.discoveries).to.deep.equal([2, 3]);
    expect(banked.career.winStreak).to.equal(1);
    expect(banked.unlocked).to.include("singularity-survivor");
    const lost = recordTour(banked.career, tour(TourStatus.CAPTURED, [2, 3]), WAGER);
    expect(lost.discoveries).to.deep.equal([]); // only the resolved Pulsar leg survived, already charted
    expect(lost.career.winStreak).to.equal(0);
    career = { ...lost.career, discovered: [0, 1, 2, 3, 4, 5, 6] };
    const explorer = recordTour(career, tour(TourStatus.EJECTED, [7], WAGER * 2n), WAGER);
    expect(explorer.discoveries).to.deep.equal([7]);
    expect(explorer.unlocked).to.include("galaxy-explorer");
  });

  it("mission names follow the riskiest body by survival odds, not by body id", () => {
    // Comet (id 4) is the safest body; Pulsar (id 2) is the riskiest here.
    expect(missionDesignation([4, 2])).to.match(/^(PULSAR DART|BEACON|HELIOS)-II$/);
    expect(missionDesignation([2, 3, 2, 3])).to.match(/-X$/);
  });
});
