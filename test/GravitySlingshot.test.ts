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
  const COMET = 4;
  const NEPTUNE = 5;
  const SATURN = 6;
  const RED_GIANT = 7;
  const BODY_COUNT = 8;
  const BODIES = [MOON, JUPITER, PULSAR, BLACK_HOLE, COMET, NEPTUNE, SATURN, RED_GIANT];
  const SURVIVE_BPS = [8000n, 5000n, 2500n, 1250n, 9000n, 7500n, 6250n, 4000n];
  const MULT = [
    [5n, 4n],
    [2n, 1n],
    [4n, 1n],
    [8n, 1n],
    [10n, 9n],
    [4n, 3n],
    [8n, 5n],
    [5n, 2n],
  ];
  const LAUNCH = 1;
  const EJECT = 2;
  // 10^18 * 3^6 is divisible by every route denominator (up to 4^4, 5^4 and 3^6) times 100,
  // so every payout is exact and the 93% identity can be checked in integers.
  const WAGER = 10n ** 18n * 729n;

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
    return (WAGER * num * 9300n) / (den * 10000n);
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
    // Top route multiplier per first body as an exact fraction [num, den] (paid = x 0.93).
    const TOP: Record<number, [bigint, bigint]> = {
      [COMET]: [2560n, 9n], // 284.44x gross, 264.53x paid
      [MOON]: [320n, 1n], // 297.6x paid
      [NEPTUNE]: [1024n, 3n], // 341.33x gross, 317.44x paid
      [SATURN]: [2048n, 5n], // 409.6x gross, 380.928x paid
      [JUPITER]: [512n, 1n], // 476.16x paid
      [RED_GIANT]: [640n, 1n], // 595.2x paid
      [PULSAR]: [1024n, 1n], // 952.32x paid
      [BLACK_HOLE]: [1024n, 1n],
    };

    it("reserves exactly the top route reachable from each first body", async () => {
      for (const body of BODIES) {
        const [num, den] = TOP[body];
        const payout = (WAGER * num * 93n) / (den * 100n);
        const [escrow, reserve] = await game.read.quoteCaps([WAGER, gameData(body)]);
        expect(escrow).to.equal(WAGER);
        expect(reserve).to.equal(payout - WAGER);
      }
      // The cap never grows with the new bodies: 952.32x is still the ceiling.
      const [, pulsarReserve] = await game.read.quoteCaps([WAGER, gameData(PULSAR)]);
      expect(pulsarReserve + WAGER).to.equal((WAGER * 95232n) / 100n);
    });

    it("quotes risk params: top-tier probability, 93% mean, strategy-bounded body variance", async () => {
      const secondMoments: Record<number, bigint> = {
        [COMET]: 178n,
        [MOON]: 200n,
        [NEPTUNE]: 214n,
        [SATURN]: 256n,
        [JUPITER]: 320n,
        [RED_GIANT]: 400n,
        [PULSAR]: 640n,
        [BLACK_HOLE]: 640n,
      };
      const cases = BODIES.map(body => {
        const [num, den] = TOP[body];
        return { body, prob: (den * 10n ** 18n + num - 1n) / num, secondMoment: secondMoments[body] };
      });
      // Spot-check two probabilities by hand: 1/1024 and 9/2560.
      expect(cases[PULSAR].prob).to.equal(976_562_500_000_000n);
      expect(cases[COMET].prob).to.equal(3_515_625_000_000_000n);
      for (const { body, prob, secondMoment } of cases) {
        const [maxPayout, probabilityWad, expected, bodyVar] = await game.read.quoteRiskParams([
          WAGER,
          gameData(body),
        ]);
        const [, reserve] = await game.read.quoteCaps([WAGER, gameData(body)]);
        expect(maxPayout).to.equal(WAGER + reserve);
        expect(probabilityWad).to.equal(prob);
        expect(expected).to.equal((WAGER * 93n) / 100n);
        const perUnitWad = (9300n * 9300n * (secondMoment - 1n) * 10n ** 18n) / 10n ** 8n;
        expect(bodyVar).to.equal(WAGER * WAGER * perUnitWad);
      }
    });

    it("rejects malformed gameData and unknown bodies", async () => {
      await expectRevert(game.read.quoteCaps([WAGER, gameData(BODY_COUNT)]), "GravitySlingshot__InvalidBody");
      await expectRevert(game.read.topRoute([BODY_COUNT]), "GravitySlingshot__InvalidBody");
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
        game.read.onPlayerAction([ctxFor(JUPITER, cruising), action(LAUNCH, BODY_COUNT)]),
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
      expect(settle.payout).to.equal(WAGER + reserve); // 952.32x, no slack and no overflow
      expect(decodeTour(settle.newGameState).status).to.equal(Status.COMPLETE);
    });
  });

  describe("exhaustive strategy check (every route x every eject point)", () => {
    const routes = allRoutes();

    it("enumerates all 3200 legal strategies", () => {
      expect(routes.length).to.equal(8 + 56 + 392 + 2744);
    });

    it("every leg is exactly fair: surviveBps * multiplier == 1", async () => {
      for (const body of BODIES) {
        const [num, den] = await game.read.legMultiplier([body]);
        expect(BigInt(await game.read.surviveBps([body])) * num).to.equal(10000n * den);
        expect([num, den]).to.deep.equal(MULT[body]);
      }
    });

    it("pays exactly 93.00% expected return for every strategy, within the reserve", async () => {
      for (const route of routes) {
        const { settle, reserve } = await flyAndBank(route);
        expect(settle.payout).to.equal(expectedPayout(route));
        expect(settle.payout <= WAGER + reserve).to.equal(true);
        expect(BigInt(settle.escrowDelta)).to.equal(0n);
        expect(BigInt(settle.reservedProfitDelta)).to.equal(0n);
        // E[payout] = P(survive every leg) * payout, checked in exact integer arithmetic.
        const surviveNum = route.reduce((acc, body) => acc * SURVIVE_BPS[body], 1n);
        const scale = 10000n ** BigInt(route.length);
        expect(settle.payout * surviveNum * 100n).to.equal(WAGER * 93n * scale);
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
        expect(fromFirst.filter(r => product(r) === best).length).to.equal(1); // unique top route
        const nonTop = Math.max(...fromFirst.filter(r => r.join() !== top.join()).map(product));
        const bound = Number(await game.read.nonTopSecondMoment([first]));
        // The bound is the enumerated maximum rounded up (Comet and Neptune routes are fractional).
        expect(bound).to.equal(Math.ceil(nonTop - 1e-9));
        expect(bound).to.equal([200, 320, 640, 640, 178, 214, 256, 400][first]);
      }
    });
  });
});
