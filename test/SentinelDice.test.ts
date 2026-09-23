import { expect } from "chai";
import hre from "hardhat";
import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters, keccak256, toHex } from "viem";

describe("SentinelDice Protocol Tests", () => {
  let sentinelDice: any;
  let publicClient: any;
  let testClient: any;

  // Enum mirror
  const SessionPhase = {
    NONE: 0,
    WAITING_RANDOMNESS: 1,
    WAITING_PLAYER_ACTION: 2,
    SETTLED: 3,
    FORFEITED: 4,
    CANCELLED: 5,
  };

  const BET_UNDER = 0;
  const BET_OVER = 1;
  const BET_EXACT = 2;
  const BET_EVEN = 3;
  const BET_ODD = 4;
  const BET_DOUBLES = 5;

  before(async () => {
    publicClient = await hre.viem.getPublicClient();
    sentinelDice = await hre.viem.deployContract("SentinelDice");
  });

  function encodeGameData(betType: number, targetSum: number): `0x${string}` {
    return encodeAbiParameters(parseAbiParameters("uint8, uint8"), [betType, targetSum]);
  }

  describe("Math & Combinatorics Verification", () => {
    it("computes exact combinatorial winning ways for all sum combinations", async () => {
      // Under 7: sum < 7 (sums 2..6: 1+2+3+4+5 = 15 ways)
      const waysUnder7 = await sentinelDice.read.winningWays([BET_UNDER, 7]);
      expect(waysUnder7).to.equal(15n);

      // Over 8: sum > 8 (sums 9..12: 4+3+2+1 = 10 ways)
      const waysOver8 = await sentinelDice.read.winningWays([BET_OVER, 8]);
      expect(waysOver8).to.equal(10n);

      // Exact 7: 6 ways
      const waysExact7 = await sentinelDice.read.winningWays([BET_EXACT, 7]);
      expect(waysExact7).to.equal(6n);

      // Exact 2: 1 way
      const waysExact2 = await sentinelDice.read.winningWays([BET_EXACT, 2]);
      expect(waysExact2).to.equal(1n);

      // Even & Odd: 18 ways each
      const waysEven = await sentinelDice.read.winningWays([BET_EVEN, 0]);
      const waysOdd = await sentinelDice.read.winningWays([BET_ODD, 0]);
      expect(waysEven).to.equal(18n);
      expect(waysOdd).to.equal(18n);

      // Doubles: 6 ways
      const waysDoubles = await sentinelDice.read.winningWays([BET_DOUBLES, 0]);
      expect(waysDoubles).to.equal(6n);
    });

    it("reverts on out-of-bounds targetSum for bet types", async () => {
      // Under target 2 is impossible (sum >= 2)
      let failed = false;
      try {
        await sentinelDice.read.winningWays([BET_UNDER, 2]);
      } catch {
        failed = true;
      }
      expect(failed).to.be.true;

      // Over target 12 is impossible (sum <= 12)
      failed = false;
      try {
        await sentinelDice.read.winningWays([BET_OVER, 12]);
      } catch {
        failed = true;
      }
      expect(failed).to.be.true;

      // Exact target 13 is impossible
      failed = false;
      try {
        await sentinelDice.read.winningWays([BET_EXACT, 13]);
      } catch {
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });

  describe("quoteCaps & quoteRiskParams Exact Wei Agreement", () => {
    it("guarantees 1-wei identity between quoteCaps maxPayout and expected payout", async () => {
      const wager = 1000000000000000000n; // 1 ETH
      const gameData = encodeGameData(BET_UNDER, 7);

      const [maxEscrowStake, maxReservedProfit] = await sentinelDice.read.quoteCaps([wager, gameData]);
      expect(maxEscrowStake).to.equal(wager);

      // Payout = (1e18 * 9800 * 36) / (10000 * 15) = 2.352 ETH
      const expectedPayout = 2352000000000000000n;
      expect(maxReservedProfit).to.equal(expectedPayout - wager);

      const [maxPayout, probabilityWad, expectedPayoutReturn, bodyVariance] =
        await sentinelDice.read.quoteRiskParams([wager, gameData]);

      expect(maxPayout).to.equal(expectedPayout);
      expect(probabilityWad).to.equal((15n * 1000000000000000000n) / 36n);
      expect(expectedPayoutReturn).to.equal((wager * 9800n) / 10000n);
      expect(bodyVariance).to.equal(0n);
    });
  });

  describe("Session Lifecycle Verification", () => {
    it("returns correct StepResult on onSessionStart", async () => {
      const wager = 500000000000000000n; // 0.5 ETH
      const gameData = encodeGameData(BET_DOUBLES, 0);

      const ctx = {
        sessionId: 1n,
        player: "0x1111111111111111111111111111111111111111",
        vault: "0x2222222222222222222222222222222222222222",
        wagerBase: wager,
        escrowedStake: wager,
        reservedProfit: 0n,
        step: 0,
        gameData,
        gameState: "0x",
      };

      const stepResult = await sentinelDice.read.onSessionStart([ctx]);
      expect(stepResult.nextPhase).to.equal(SessionPhase.WAITING_RANDOMNESS);
      expect(stepResult.requestRandomnessNow).to.be.true;
      // Doubles payout = (0.5 * 9800 * 36) / (10000 * 6) = 2.94 ETH -> profit = 2.44 ETH
      expect(stepResult.reservedProfitDelta).to.equal(2440000000000000000n);
    });

    it("verifies onRandomness settles with zero reservedProfitDelta and exact payout", async () => {
      const wager = 1000000000000000000n; // 1 ETH
      const gameData = encodeGameData(BET_UNDER, 7);

      const ctx = {
        sessionId: 1n,
        player: "0x1111111111111111111111111111111111111111",
        vault: "0x2222222222222222222222222222222222222222",
        wagerBase: wager,
        escrowedStake: wager,
        reservedProfit: 1352000000000000000n,
        step: 1,
        gameData,
        gameState: "0x",
      };

      // Test with arbitrary randomness seed
      const testSeed = keccak256(toHex("test_entropy_12345"));
      const stepResult = await sentinelDice.read.onRandomness([ctx, testSeed]);

      expect(stepResult.nextPhase).to.equal(SessionPhase.SETTLED);
      // Invariant: MUST return 0 on settling step to prevent cap truncation
      expect(stepResult.reservedProfitDelta).to.equal(0n);
      expect(stepResult.escrowDelta).to.equal(0n);

      if (stepResult.payout > 0n) {
        expect(stepResult.payout).to.equal(2352000000000000000n);
      } else {
        expect(stepResult.payout).to.equal(0n);
      }
    });

    it("verifies quoteForfeitPayout returns 0", async () => {
      const ctx = {
        sessionId: 1n,
        player: "0x1111111111111111111111111111111111111111",
        vault: "0x2222222222222222222222222222222222222222",
        wagerBase: 1000000n,
        escrowedStake: 1000000n,
        reservedProfit: 500000n,
        step: 0,
        gameData: encodeGameData(BET_EVEN, 0),
        gameState: "0x",
      };
      const forfeitQuote = await sentinelDice.read.quoteForfeitPayout([ctx]);
      expect(forfeitQuote).to.equal(0n);
    });

    it("rejects onPlayerAction as game resolves atomically on randomness", async () => {
      const ctx = {
        sessionId: 1n,
        player: "0x1111111111111111111111111111111111111111",
        vault: "0x2222222222222222222222222222222222222222",
        wagerBase: 1000000n,
        escrowedStake: 1000000n,
        reservedProfit: 500000n,
        step: 0,
        gameData: encodeGameData(BET_EVEN, 0),
        gameState: "0x",
      };
      let failed = false;
      try {
        await sentinelDice.read.onPlayerAction([ctx, "0x"]);
      } catch {
        failed = true;
      }
      expect(failed).to.be.true;
    });
  });

  describe("Rejection Sampling Uniformity & Boundary Invariants", () => {
    it("ensures all simulated rolls produce valid faces in [1, 6] across 100 seeds", async () => {
      const gameData = encodeGameData(BET_EVEN, 0);
      const ctx = {
        sessionId: 1n,
        player: "0x1111111111111111111111111111111111111111",
        vault: "0x2222222222222222222222222222222222222222",
        wagerBase: 1000000000000000000n,
        escrowedStake: 1000000000000000000n,
        reservedProfit: 960000000000000000n,
        step: 1,
        gameData,
        gameState: "0x",
      };

      const faceCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };

      for (let i = 0; i < 100; i++) {
        const seed = keccak256(toHex(`seed_iteration_${i}`));
        const result = await sentinelDice.read.onRandomness([ctx, seed]);
        expect(result.nextPhase).to.equal(SessionPhase.SETTLED);

        // Decode newGameState: (uint8 d1, uint8 d2, uint8 sum, bool won, uint256 payout)
        const [d1, d2, sum, won, payout] = decodeAbiParameters(
          parseAbiParameters("uint8, uint8, uint8, bool, uint256"),
          result.newGameState,
        );

        expect(d1).to.be.gte(1).and.lte(6);
        expect(d2).to.be.gte(1).and.lte(6);
        expect(sum).to.equal(d1 + d2);
        faceCounts[d1]++;
        faceCounts[d2]++;
      }

      // Verify all faces 1..6 appeared at least once across 200 dice rolls
      for (let face = 1; face <= 6; face++) {
        expect(faceCounts[face]).to.be.greaterThan(0);
      }
    });
  });
});
