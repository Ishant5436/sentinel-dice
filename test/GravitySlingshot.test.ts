import { expect } from "chai";
import hre from "hardhat";
import { decodeAbiParameters, encodeAbiParameters, parseAbiParameters, type Hex } from "viem";

// Grand Tour: up to four gravity assists, fresh VRF per leg, eject between legs.
describe("GravitySlingshot: Grand Tour (ICasinoGameV2)", () => {
  let game: any;

  const Phase = { WAITING_RANDOMNESS: 1, WAITING_PLAYER_ACTION: 2, SETTLED: 3 };
  const Status = { CRUISING: 0, BURNING: 1, CAPTURED: 2, EJECTED: 3, COMPLETE: 4 };
  const MOON = 0;
  const JUPITER = 1;
  const PULSAR = 2;
  const BLACK_HOLE = 3;
  const BODIES = [MOON, JUPITER, PULSAR, BLACK_HOLE];
  const SURVIVE_BPS = [8000n, 5000n, 2500n, 1250n];
  const MULT = [
    [5n, 4n],
    [2n, 1n],
    [4n, 1n],
    [8n, 1n],
  ];
  const LAUNCH = 1;
  const EJECT = 2;
  const WAGER = 10n ** 18n; // divisible by 4^4 * 100, so every payout is exact

  const TOUR_ABI = parseAbiParameters(
    "uint8 status, uint8 legs, uint8[4] route, uint16[4] rolls, uint256 payout"
  );

  before(async () => {
    game = await hre.viem.deployContract("GravitySlingshot");
  });

  const gameData = (firstBody: number): Hex =>
    encodeAbiParameters(parseAbiParameters("uint8 firstBody"), [firstBody]);

  const action = (kind: number, body = 0): Hex =>
    encodeAbiParameters(parseAbiParameters("uint8 action, uint8 body"), [kind, body]);

  // Seeds below the rejection limit map straight to roll = seed % 10000.
  const seedForRoll = (roll: number): Hex => `0x${roll.toString(16).padStart(64, "0")}`;
  const SURVIVE = seedForRoll(0);
  const CAPTURE = seedForRoll(9999);

  function decodeTour(state: Hex) {
    const [status, legs, route, rolls, payout] = decodeAbiParameters(TOUR_ABI, state);
    return { status, legs, route: [...route], rolls: [...rolls], payout };
  }

  function ctxFor(firstBody: number, gameState: Hex = "0x", reservedProfit = 0n) {
    return {
      sessionId: 7n,
      player: "0x1111111111111111111111111111111111111111" as Hex,
      vault: "0x2222222222222222222222222222222222222222" as Hex,
      wagerBase: WAGER,
      escrowedStake: WAGER,
      reservedProfit,
      step: 0,
      gameData: gameData(firstBody),
      gameState,
    };
  }

  async function expectRevert(promise: Promise<unknown>, reason: string) {
    try {
      await promise;
      expect.fail(`expected revert: ${reason}`);
    } catch (err: any) {
      expect(err.message).to.include(reason);
    }
  }

  // Exact rational multiplier of a route, and the payout the contract must produce.
  function routeFraction(route: number[]) {
    return route.reduce(
      (acc, body) => [acc[0] * MULT[body][0], acc[1] * MULT[body][1]],
      [1n, 1n]
    );
  }
  const expectedPayout = (route: number[]) => {
    const [num, den] = routeFraction(route);
    return (WAGER * num * 9800n) / (den * 10000n);
  };

  // Every legal route: any first body, then never the same body twice in a row.
  function allRoutes(maxLegs = 4): number[][] {
    const out: number[][] = [];
    const grow = (route: number[]) => {
      out.push(route);
      if (route.length === maxLegs) return;
      for (const body of BODIES) if (body !== route[route.length - 1]) grow([...route, body]);
    };
    for (const body of BODIES) grow([body]);
    return out;
  }

  // Drive the real handlers: open, survive every leg, then eject (or auto-complete).
  async function flyAndBank(route: number[]) {
    const start = await game.read.onSessionStart([ctxFor(route[0])]);
    const reserve = BigInt(start.reservedProfitDelta);
    let state: Hex = start.newGameState;
    for (let leg = 0; leg < route.length; leg++) {
      if (leg > 0) {
        const launched = await game.read.onPlayerAction([
          ctxFor(route[0], state, reserve),
          action(LAUNCH, route[leg]),
        ]);
        expect(launched.nextPhase).to.equal(Phase.WAITING_RANDOMNESS);
        expect(launched.requestRandomnessNow).to.equal(true);
        state = launched.newGameState;
      }
      const resolved = await game.read.onRandomness([ctxFor(route[0], state, reserve), SURVIVE]);
      if (leg === 3) return { settle: resolved, reserve };
      expect(resolved.nextPhase).to.equal(Phase.WAITING_PLAYER_ACTION);
      state = resolved.newGameState;
    }
    const cashout = await game.read.quoteForfeitPayout([ctxFor(route[0], state, reserve)]);
    const settle = await game.read.onPlayerAction([
      ctxFor(route[0], state, reserve),
      action(EJECT),
    ]);
    expect(cashout).to.equal(settle.payout);
    return { settle, reserve };
  }

  describe("paytable and quotes", () => {
    it("reserves exactly the top route reachable from each first body", async () => {
      const cases = [
        { body: MOON, payout: 313_600_000_000_000_000_000n }, // 320x * 0.98
        { body: JUPITER, payout: 501_760_000_000_000_000_000n }, // 512x * 0.98
        { body: PULSAR, payout: 1_003_520_000_000_000_000_000n }, // 1024x * 0.98
        { body: BLACK_HOLE, payout: 1_003_520_000_000_000_000_000n },
      ];
      for (const { body, payout } of cases) {
        const [escrow, reserve] = await game.read.quoteCaps([WAGER, gameData(body)]);
        expect(escrow).to.equal(WAGER);
        expect(reserve).to.equal(payout - WAGER);
      }
    });

    it("quotes risk params: top-tier probability, 98% mean, strategy-bounded body variance", async () => {
      const cases = [
        { body: MOON, prob: 3_125_000_000_000_000n, secondMoment: 160n }, // 1/320
        { body: JUPITER, prob: 1_953_125_000_000_000n, secondMoment: 256n }, // 1/512
        { body: PULSAR, prob: 976_562_500_000_000n, secondMoment: 512n }, // 1/1024
        { body: BLACK_HOLE, prob: 976_562_500_000_000n, secondMoment: 512n },
      ];
      for (const { body, prob, secondMoment } of cases) {
        const [maxPayout, probabilityWad, expected, bodyVar] = await game.read.quoteRiskParams([
          WAGER,
          gameData(body),
        ]);
        const [, reserve] = await game.read.quoteCaps([WAGER, gameData(body)]);
        expect(maxPayout).to.equal(WAGER + reserve);
        expect(probabilityWad).to.equal(prob);
        expect(expected).to.equal((WAGER * 98n) / 100n);
        const perUnitWad = (9800n * 9800n * (secondMoment - 1n) * 10n ** 18n) / 10n ** 8n;
        expect(bodyVar).to.equal(WAGER * WAGER * perUnitWad);
      }
    });

    it("rejects malformed gameData and unknown bodies", async () => {
      await expectRevert(game.read.quoteCaps([WAGER, gameData(4)]), "GravitySlingshot__InvalidBody");
      await expectRevert(game.read.quoteCaps([WAGER, "0x01"]), "GravitySlingshot__InvalidGameData");
      await expectRevert(game.read.quoteCaps([0n, gameData(MOON)]), "GravitySlingshot__InvalidWager");
    });
  });

  describe("session state machine", () => {
    it("opens by launching leg 1 and committing the full reserve", async () => {
      const [, reserve] = await game.read.quoteCaps([WAGER, gameData(PULSAR)]);
      const start = await game.read.onSessionStart([ctxFor(PULSAR)]);
      expect(start.nextPhase).to.equal(Phase.WAITING_RANDOMNESS);
      expect(start.requestRandomnessNow).to.equal(true);
      expect(BigInt(start.reservedProfitDelta)).to.equal(reserve);
      expect(BigInt(start.escrowDelta)).to.equal(0n);
      const tour = decodeTour(start.newGameState);
      expect(tour.status).to.equal(Status.BURNING);
      expect(tour.legs).to.equal(1);
      expect(tour.route).to.deep.equal([PULSAR, 255, 255, 255]);
    });

    it("captures the probe on a failed roll: settles with zero payout and zero deltas", async () => {
      const start = await game.read.onSessionStart([ctxFor(MOON)]);
      const lost = await game.read.onRandomness([ctxFor(MOON, start.newGameState), CAPTURE]);
      expect(lost.nextPhase).to.equal(Phase.SETTLED);
      expect(lost.payout).to.equal(0n);
      expect(BigInt(lost.escrowDelta)).to.equal(0n);
      expect(BigInt(lost.reservedProfitDelta)).to.equal(0n);
      const tour = decodeTour(lost.newGameState);
      expect(tour.status).to.equal(Status.CAPTURED);
      expect(tour.rolls[0]).to.equal(9999);
    });

    it("uses the exact survival thresholds (roll < threshold survives)", async () => {
      for (const body of BODIES) {
        const start = await game.read.onSessionStart([ctxFor(body)]);
        const edge = Number(SURVIVE_BPS[body]);
        const last = await game.read.onRandomness([ctxFor(body, start.newGameState), seedForRoll(edge - 1)]);
        const first = await game.read.onRandomness([ctxFor(body, start.newGameState), seedForRoll(edge)]);
        expect(last.nextPhase).to.equal(Phase.WAITING_PLAYER_ACTION);
        expect(first.nextPhase).to.equal(Phase.SETTLED);
      }
    });

    it("enforces the route rule, the action codes and the phase guards", async () => {
      const start = await game.read.onSessionStart([ctxFor(JUPITER)]);
      const burning = start.newGameState;
      await expectRevert(
        game.read.onPlayerAction([ctxFor(JUPITER, burning), action(EJECT)]),
        "GravitySlingshot__NotCruising"
      );
      const cruising = (await game.read.onRandomness([ctxFor(JUPITER, burning), SURVIVE])).newGameState;
      await expectRevert(
        game.read.onRandomness([ctxFor(JUPITER, cruising), SURVIVE]),
        "GravitySlingshot__NotBurning"
      );
      await expectRevert(
        game.read.onPlayerAction([ctxFor(JUPITER, cruising), action(LAUNCH, JUPITER)]),
        "GravitySlingshot__RepeatBody"
      );
      await expectRevert(
        game.read.onPlayerAction([ctxFor(JUPITER, cruising), action(LAUNCH, 4)]),
        "GravitySlingshot__InvalidBody"
      );
      await expectRevert(
        game.read.onPlayerAction([ctxFor(JUPITER, cruising), action(9)]),
        "GravitySlingshot__InvalidAction"
      );
    });

    it("quotes a forfeit value only while cruising, never while a leg is in flight", async () => {
      const start = await game.read.onSessionStart([ctxFor(PULSAR)]);
      expect(await game.read.quoteForfeitPayout([ctxFor(PULSAR, start.newGameState)])).to.equal(0n);
      expect(await game.read.quoteForfeitPayout([ctxFor(PULSAR)])).to.equal(0n);
      const cruising = (await game.read.onRandomness([ctxFor(PULSAR, start.newGameState), SURVIVE]))
        .newGameState;
      expect(await game.read.quoteForfeitPayout([ctxFor(PULSAR, cruising)])).to.equal(
        expectedPayout([PULSAR])
      );
    });

    it("auto-settles after the fourth assist and pays exactly the committed cap", async () => {
      const route = [PULSAR, BLACK_HOLE, PULSAR, BLACK_HOLE];
      const { settle, reserve } = await flyAndBank(route);
      expect(settle.nextPhase).to.equal(Phase.SETTLED);
      expect(settle.payout).to.equal(WAGER + reserve); // 1003.52x, no slack and no overflow
      expect(decodeTour(settle.newGameState).status).to.equal(Status.COMPLETE);
    });
  });

  describe("exhaustive strategy check (every route x every eject point)", () => {
    const routes = allRoutes();

    it("enumerates all 160 legal strategies", () => {
      expect(routes.length).to.equal(4 + 12 + 36 + 108);
    });

    it("pays exactly 98.00% expected return for every strategy, within the reserve", async () => {
      for (const route of routes) {
        const { settle, reserve } = await flyAndBank(route);
        expect(settle.payout).to.equal(expectedPayout(route));
        expect(settle.payout <= WAGER + reserve).to.equal(true);
        expect(BigInt(settle.escrowDelta)).to.equal(0n);
        expect(BigInt(settle.reservedProfitDelta)).to.equal(0n);
        // E[payout] = P(survive every leg) * payout, checked in exact integer arithmetic.
        const surviveNum = route.reduce((acc, body) => acc * SURVIVE_BPS[body], 1n);
        const scale = 10000n ** BigInt(route.length);
        expect(settle.payout * surviveNum * 100n).to.equal(WAGER * 98n * scale);
      }
    });

    it("topRoute is the best route, and the body-variance bound covers every non-top route", async () => {
      for (const first of BODIES) {
        const top = (await game.read.topRoute([first])).map(Number);
        const product = (r: number[]) => {
          const [num, den] = routeFraction(r);
          return Number(num) / Number(den);
        };
        const fromFirst = routes.filter(r => r[0] === first);
        const best = Math.max(...fromFirst.map(product));
        expect(product(top)).to.equal(best);
        const nonTop = fromFirst.filter(r => r.join() !== top.join()).map(product);
        expect(Math.max(...nonTop)).to.equal(Number(await game.read.nonTopSecondMoment([first])));
        expect(Math.max(...nonTop)).to.equal([160, 256, 512, 512][first]);
      }
    });
  });
});
