import { expect } from "chai";
import hre from "hardhat";
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from "viem";

describe("SentinelDice Full Host Integration Tests", () => {
  let publicClient: any;
  let walletClients: any[];
  let deployer: any;
  let player: any;

  let token: any;
  let router: any;
  let host: any;
  let vaultAddress: `0x${string}`;
  let sentinelDice: any;

  const BET_UNDER = 0;
  const BET_OVER = 1;
  const BET_EXACT = 2;
  const BET_EVEN = 3;

  function encodeGameData(betType: number, targetSum: number): `0x${string}` {
    return encodeAbiParameters(parseAbiParameters("uint8, uint8"), [betType, targetSum]);
  }

  before(async () => {
    publicClient = await hre.viem.getPublicClient();
    walletClients = await hre.viem.getWalletClients();
    deployer = walletClients[0];
    player = walletClients[1];

    // 1. Deploy test token
    token = await hre.viem.deployContract("LocalTestToken");

    // 2. Deploy mock verify router
    router = await hre.viem.deployContract("MockVerifyRouter");

    // 3. Deploy LocalCasinoHost
    host = await hre.viem.deployContract("LocalCasinoHost", [token.address, router.address]);
    vaultAddress = await host.read.vault();

    // 4. Deploy SentinelDice
    sentinelDice = await hre.viem.deployContract("SentinelDice");

    // 5. Register game on host
    await host.write.registerGame([sentinelDice.address, "SentinelDice"]);

    // 6. Fund the casino vault with 50,000 CUSD
    const vaultFunding = 50000n * 10n ** 18n;
    await token.write.mint([vaultAddress, vaultFunding]);

    // 7. Fund the player with 1,000 CUSD
    const playerFunding = 1000n * 10n ** 18n;
    await token.write.mint([player.account.address, playerFunding]);

    // 8. Player approves host
    const playerToken = await hre.viem.getContractAt("LocalTestToken", token.address, {
      client: { wallet: player },
    });
    await playerToken.write.approve([host.address, 1000000n * 10n ** 18n]);
  });

  it("completes full lifecycle: openSession -> verify request -> fulfill randomness -> settle", async () => {
    const wager = 10n * 10n ** 18n; // 10 CUSD
    // Bet Even: 18 ways, 50% probability, 1.96x payout = 19.6 CUSD
    const gameData = encodeGameData(BET_EVEN, 0);

    const playerHost = await hre.viem.getContractAt("LocalCasinoHost", host.address, {
      client: { wallet: player },
    });

    const initialPlayerBal = await token.read.balanceOf([player.account.address]);

    // Step 1: Player opens session
    await playerHost.write.openSession([
      sentinelDice.address,
      vaultAddress,
      wager,
      gameData,
    ]);

    // Verify wager was escrowed
    const afterOpenBal = await token.read.balanceOf([player.account.address]);
    expect(afterOpenBal).to.equal(initialPlayerBal - wager);

    // Verify router received randomness request
    const lastRequestId = await router.read.lastRequestId();
    const lastClientData = await router.read.lastClientData();
    expect(lastRequestId).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");

    // Step 2: Router fulfills with deterministic randomness
    const testRandomness = keccak256(toHex("integration_test_seed_even_check"));
    await router.write.fulfill([host.address, lastRequestId, testRandomness, lastClientData]);

    // Step 3: Check final settlement
    const finalPlayerBal = await token.read.balanceOf([player.account.address]);

    // Either player won 19.6 CUSD (balance = initial - 10 + 19.6 = initial + 9.6)
    // Or player lost (balance = initial - 10)
    const expectedWinBal = initialPlayerBal - wager + 19600000000000000000n;
    const expectedLossBal = initialPlayerBal - wager;

    const isWin = finalPlayerBal === expectedWinBal;
    const isLoss = finalPlayerBal === expectedLossBal;

    expect(isWin || isLoss).to.be.true;
  });

  it("handles high multiplier Under 4 bet (3 ways, 11.76x) without invalid payout errors", async () => {
    const wager = 5n * 10n ** 18n; // 5 CUSD
    // Bet Under 4 (sums 2, 3: 1+2 = 3 ways). Multiplier = 0.98 * 36 / 3 = 11.76x. Payout = 58.8 CUSD
    const gameData = encodeGameData(BET_UNDER, 4);

    const playerHost = await hre.viem.getContractAt("LocalCasinoHost", host.address, {
      client: { wallet: player },
    });

    const initialBal = await token.read.balanceOf([player.account.address]);

    await playerHost.write.openSession([
      sentinelDice.address,
      vaultAddress,
      wager,
      gameData,
    ]);

    const lastRequestId = await router.read.lastRequestId();
    const lastClientData = await router.read.lastClientData();

    // Fulfill
    const testRandomness = keccak256(toHex("high_multiplier_under_4_test"));
    await router.write.fulfill([host.address, lastRequestId, testRandomness, lastClientData]);

    const finalBal = await token.read.balanceOf([player.account.address]);
    const expectedWinBal = initialBal - wager + 58800000000000000000n;
    const expectedLossBal = initialBal - wager;

    expect(finalBal === expectedWinBal || finalBal === expectedLossBal).to.be.true;
  });
});
