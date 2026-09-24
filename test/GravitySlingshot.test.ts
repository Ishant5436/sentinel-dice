import { expect } from "chai";
import hre from "hardhat";
import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from "viem";

describe("GravitySlingshot Protocol (ICasinoGameV2)", () => {
  let slingshot: any;

  const SessionPhase = {
    NONE: 0,
    WAITING_RANDOMNESS: 1,
    WAITING_PLAYER_ACTION: 2,
    SETTLED: 3,
    FORFEITED: 4,
    CANCELLED: 5,
  };

  before(async () => {
    slingshot = await hre.viem.deployContract("GravitySlingshot");
  });

  function encodeSlingshotData(riskRatingBps: number, celestialId: number = 0) {
    return encodeAbiParameters(
      parseAbiParameters("uint16 riskRatingBps, uint8 celestialId"),
      [riskRatingBps, celestialId]
    );
  }

  describe("Deployment & Configuration", () => {
    it("should deploy and configure constants correctly with 98.00% RTP", async () => {
      const rtpBps = await slingshot.read.RTP_BPS();
      const minRisk = await slingshot.read.MIN_RISK_BPS();
      const maxRisk = await slingshot.read.MAX_RISK_BPS();

      expect(rtpBps).to.equal(9800n);
      expect(minRisk).to.equal(100);
      expect(maxRisk).to.equal(9800);
    });
  });

  describe("quoteCaps & quoteRiskParams", () => {
    it("should calculate accurate maxCaps for various risk ratings", async () => {
      const wager = 1000000000000000000n; // 1 ETH (1e18)

      // 50% Win Chance (5000 bps) -> Multiplier 9800 / 5000 = 1.96x
      // Gross Payout = 1.96 ETH, Profit = 0.96 ETH
      const gameData50 = encodeSlingshotData(5000, 0);
      const [escrow50, profit50] = await slingshot.read.quoteCaps([wager, gameData50]);
      expect(escrow50).to.equal(wager);
      expect(profit50).to.equal(960000000000000000n); // 0.96 ETH

      // 10% Win Chance (1000 bps) -> Multiplier 9800 / 1000 = 9.8x
      // Gross Payout = 9.8 ETH, Profit = 8.8 ETH
      const gameData10 = encodeSlingshotData(1000, 1);
      const [escrow10, profit10] = await slingshot.read.quoteCaps([wager, gameData10]);
      expect(escrow10).to.equal(wager);
      expect(profit10).to.equal(8800000000000000000n); // 8.8 ETH

      // 2% Win Chance (200 bps) -> Multiplier 9800 / 200 = 49.0x
      // Gross Payout = 49 ETH, Profit = 48 ETH
      const gameData2 = encodeSlingshotData(200, 2);
      const [escrow2, profit2] = await slingshot.read.quoteCaps([wager, gameData2]);
      expect(escrow2).to.equal(wager);
      expect(profit2).to.equal(48000000000000000000n); // 48 ETH
    });

    it("should quote portfolio risk parameters with exact 98.00% expected payout", async () => {
      const wager = 1000000000000000000n; // 1 ETH

      const testRatings = [100, 500, 1000, 2500, 5000, 8000, 9800];
      for (const rating of testRatings) {
        const gameData = encodeSlingshotData(rating, 0);
        const [maxPayout, probWad, expectedPayout, bodyVar] = await slingshot.read.quoteRiskParams([
          wager,
          gameData
        ]);

        // Expected payout MUST ALWAYS equal 0.98 * wager
        expect(expectedPayout).to.equal(980000000000000000n);
        expect(bodyVar).to.equal(0n);
        // Probability WAD = rating * 1e18 / 10000
        const expectedProbWad = (BigInt(rating) * 1000000000000000000n) / 10000n;
        expect(probWad).to.equal(expectedProbWad);
        // Max payout = wager * 9800 / rating
        const expectedMax = (wager * 9800n) / BigInt(rating);
        expect(maxPayout).to.equal(expectedMax);
      }
    });

    it("should reject invalid risk ratings or celestial IDs in quotes", async () => {
      const wager = 1000000000000000000n;

      // Below 100 bps (< 1.00%)
      const gameDataLow = encodeSlingshotData(99, 0);
      try {
        await slingshot.read.quoteCaps([wager, gameDataLow]);
        expect.fail("Should have reverted on low risk rating");
      } catch (err: any) {
        expect(err.message).to.include("reverted");
      }

      // Above 9800 bps (> 98.00%)
      const gameDataHigh = encodeSlingshotData(9801, 0);
      try {
        await slingshot.read.quoteCaps([wager, gameDataHigh]);
        expect.fail("Should have reverted on high risk rating");
      } catch (err: any) {
        expect(err.message).to.include("reverted");
      }

      // Invalid celestial ID (> 2)
      const gameDataCel = encodeSlingshotData(5000, 3);
      try {
        await slingshot.read.quoteCaps([wager, gameDataCel]);
        expect.fail("Should have reverted on invalid celestial ID");
      } catch (err: any) {
        expect(err.message).to.include("reverted");
      }
    });
  });

  describe("onSessionStart & Session Initialization", () => {
    it("should validate and initialize session into WAITING_RANDOMNESS", async () => {
      const wager = 1000000000000000000n;
      const gameData = encodeSlingshotData(5000, 1);

      const ctx = {
        sessionId: 1n,
        player: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        vault: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        wagerBase: wager,
        escrowedStake: wager,
        reservedProfit: 960000000000000000n,
        step: 0,
        gameData: gameData,
        gameState: "0x" as `0x${string}`
      };

      const result = await slingshot.read.onSessionStart([ctx]);
      expect(result.nextPhase).to.equal(SessionPhase.WAITING_RANDOMNESS);
      expect(result.requestRandomnessNow).to.be.true;
      expect(result.payout).to.equal(0n);
    });
  });

  describe("onRandomness & Settlement", () => {
    it("should settle winning Slingshot escape with exact 98% RTP payout", async () => {
      const wager = 1000000000000000000n; // 1 ETH
      const rating = 5000; // 50% win probability -> 1.96x payout
      const gameData = encodeSlingshotData(rating, 0);

      const ctx = {
        sessionId: 101n,
        player: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        vault: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        wagerBase: wager,
        escrowedStake: wager,
        reservedProfit: 960000000000000000n,
        step: 0,
        gameData: gameData,
        gameState: "0x" as `0x${string}`
      };

      // Construct a seed that yields rollBps < 5000 (e.g. 1000)
      const winningSeed = ("0x" + BigInt(1000).toString(16).padStart(64, "0")) as `0x${string}`;
      const result = await slingshot.read.onRandomness([ctx, winningSeed]);

      expect(result.nextPhase).to.equal(SessionPhase.SETTLED);
      expect(result.requestRandomnessNow).to.be.false;
      expect(result.payout).to.equal(1960000000000000000n); // 1.96 ETH
      expect(result.escrowDelta).to.equal(-BigInt(wager));
      expect(result.reservedProfitDelta).to.equal(-960000000000000000n);

      // Verify decoded game state
      const [resolved, escaped, rollBps, riskRatingBps, celestialId, payout] = decodeAbiParameters(
        parseAbiParameters("bool, bool, uint16, uint16, uint8, uint256"),
        result.newGameState
      );
      expect(resolved).to.be.true;
      expect(escaped).to.be.true;
      expect(rollBps).to.equal(1000);
      expect(riskRatingBps).to.equal(5000);
      expect(celestialId).to.equal(0);
      expect(payout).to.equal(1960000000000000000n);
    });

    it("should settle losing Slingshot capture with 0 payout", async () => {
      const wager = 1000000000000000000n;
      const rating = 5000; // 50% win chance
      const gameData = encodeSlingshotData(rating, 0);

      const ctx = {
        sessionId: 102n,
        player: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        vault: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        wagerBase: wager,
        escrowedStake: wager,
        reservedProfit: 960000000000000000n,
        step: 0,
        gameData: gameData,
        gameState: "0x" as `0x${string}`
      };

      // Construct a seed that yields rollBps >= 5000 (e.g. 7500)
      const losingSeed = ("0x" + BigInt(7500).toString(16).padStart(64, "0")) as `0x${string}`;
      const result = await slingshot.read.onRandomness([ctx, losingSeed]);

      expect(result.nextPhase).to.equal(SessionPhase.SETTLED);
      expect(result.requestRandomnessNow).to.be.false;
      expect(result.payout).to.equal(0n); // 0 payout

      const [resolved, escaped, rollBps, riskRatingBps, celestialId, payout] = decodeAbiParameters(
        parseAbiParameters("bool, bool, uint16, uint16, uint8, uint256"),
        result.newGameState
      );
      expect(resolved).to.be.true;
      expect(escaped).to.be.false;
      expect(rollBps).to.equal(7500);
      expect(payout).to.equal(0n);
    });
  });

  describe("Determinism & Safety Invariants", () => {
    it("should reject player actions since it is a single-step protocol", async () => {
      const ctx = {
        sessionId: 103n,
        player: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        vault: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        wagerBase: 1000000000000000000n,
        escrowedStake: 1000000000000000000n,
        reservedProfit: 960000000000000000n,
        step: 0,
        gameData: encodeSlingshotData(5000, 0),
        gameState: "0x" as `0x${string}`
      };

      try {
        await slingshot.read.onPlayerAction([ctx, "0x"]);
        expect.fail("Should have reverted on player action");
      } catch (err: any) {
        expect(err.message).to.include("reverted");
      }
    });

    it("should return 0 quoteForfeitPayout mid-round", async () => {
      const ctx = {
        sessionId: 104n,
        player: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        vault: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        wagerBase: 1000000000000000000n,
        escrowedStake: 1000000000000000000n,
        reservedProfit: 960000000000000000n,
        step: 0,
        gameData: encodeSlingshotData(5000, 0),
        gameState: "0x" as `0x${string}`
      };

      const forfeit = await slingshot.read.quoteForfeitPayout([ctx]);
      expect(forfeit).to.equal(0n);
    });
  });
});
