import { expect } from "chai";
import hre from "hardhat";
import { encodeAbiParameters, parseAbiParameters, parseEventLogs, type Hex } from "viem";

// End-to-end through the casino-sdk LocalCasinoHost (the simulator's stand-in for the
// production CasinoGameFacet): real escrow, reserve, payout-cap and forfeit rules.
describe("Grand Tour through the SDK LocalCasinoHost", () => {
  const WAGER = 10n ** 18n;
  const MOON = 0;
  const JUPITER = 1;
  const PULSAR = 2;
  const BLACK_HOLE = 3;
  const LAUNCH = 1;
  const EJECT = 2;
  const Phase = { SETTLED: 3, FORFEITED: 4 };
  const ACTION_TIMEOUT_BLOCKS = 43_200n;

  type HostLog = { eventName: string; args: any };

  let game: any;
  let host: any;
  let router: any;
  let token: any;
  let vault: Hex;
  let player: Hex;
  let publicClient: any;
  let testClient: any;

  const gameData = (firstBody: number): Hex =>
    encodeAbiParameters(parseAbiParameters("uint8 firstBody"), [firstBody]);
  const action = (kind: number, body = 0): Hex =>
    encodeAbiParameters(parseAbiParameters("uint8 action, uint8 body"), [kind, body]);
  // The host rejects zero randomness, so offset by 10000: roll = seed % 10000.
  const seedForRoll = (roll: number): Hex => `0x${(roll + 10_000).toString(16).padStart(64, "0")}`;

  before(async () => {
    publicClient = await hre.viem.getPublicClient();
    testClient = await hre.viem.getTestClient();
    const [wallet] = await hre.viem.getWalletClients();
    player = wallet.account.address;

    token = await hre.viem.deployContract("LocalTestToken");
    router = await hre.viem.deployContract("MockVerifyRouter");
    host = await hre.viem.deployContract("LocalCasinoHost", [token.address, router.address]);
    game = await hre.viem.deployContract("GravitySlingshot");
    vault = await host.read.vault();

    await host.write.registerGame([game.address, "GravitySlingshot"]);
    await token.write.mint([vault, 10_000n * WAGER]);
    await token.write.mint([player, 100n * WAGER]);
    await token.write.approve([host.address, 2n ** 255n]);
  });

  async function run(hash: Hex) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const logs: HostLog[] = parseEventLogs({ abi: host.abi, logs: receipt.logs });
    const advanced = logs.find(l => l.eventName === "CasinoSessionAdvanced")?.args;
    const settled = logs.find(l => l.eventName === "CasinoSessionSettled")?.args;
    return { advanced, settled };
  }
  const open = async (firstBody: number) =>
    run(await host.write.openSession([game.address, vault, WAGER, gameData(firstBody)]));
  // The host hands the encoded session to the router as clientData; echo it back.
  const vrf = async (advanced: { requestId: Hex; session: Hex }, roll: number) =>
    run(await router.write.fulfill([host.address, advanced.requestId, seedForRoll(roll), advanced.session]));
  const act = async (session: Hex, kind: number, body = 0) =>
    run(await host.write.submitAction([session, action(kind, body)]));
  const balances = async () => ({
    player: await token.read.balanceOf([player]),
    vault: await token.read.balanceOf([vault]),
  });

  it("bust: a captured probe settles at zero and the stake goes to the vault", async () => {
    const before = await balances();
    const opened = await open(MOON);
    const lost = await vrf(opened.advanced, 9_999);
    expect(lost.settled.phase).to.equal(Phase.SETTLED);
    expect(lost.settled.payout).to.equal(0n);
    const after = await balances();
    expect(after.player).to.equal(before.player - WAGER);
    expect(after.vault).to.equal(before.vault + WAGER);
  });

  it("eject after one Pulsar assist pays 4 x 0.98 = 3.92x", async () => {
    const before = await balances();
    const opened = await open(PULSAR);
    const cruising = await vrf(opened.advanced, 0);
    expect(cruising.settled).to.equal(undefined);
    const banked = await act(cruising.advanced.session, EJECT);
    expect(banked.settled.payout).to.equal((WAGER * 392n) / 100n);
    const after = await balances();
    expect(after.player).to.equal(before.player + (WAGER * 292n) / 100n);
  });

  it("the full grand tour pays 1003.52x, exactly the reserve the host committed", async () => {
    const before = await balances();
    let step = await open(PULSAR);
    for (const next of [BLACK_HOLE, PULSAR, BLACK_HOLE]) {
      const survived = await vrf(step.advanced, 0);
      step = await act(survived.advanced.session, LAUNCH, next);
    }
    const done = await vrf(step.advanced, 0);
    expect(done.settled.phase).to.equal(Phase.SETTLED);
    expect(done.settled.payout).to.equal((WAGER * 100352n) / 100n);
    const after = await balances();
    expect(after.player).to.equal(before.player + (WAGER * 100252n) / 100n);
  });

  it("the host rejects a repeat body and keeps the session live", async () => {
    const opened = await open(JUPITER);
    const cruising = await vrf(opened.advanced, 0);
    try {
      await act(cruising.advanced.session, LAUNCH, JUPITER);
      expect.fail("repeat body should revert");
    } catch (err: any) {
      expect(err.message).to.include("GravitySlingshot__RepeatBody");
    }
    const banked = await act(cruising.advanced.session, EJECT);
    expect(banked.settled.payout).to.equal((WAGER * 196n) / 100n);
  });

  it("an abandoned tour forfeits at 90% of the eject value, below what ejecting pays", async () => {
    const before = await balances();
    const opened = await open(JUPITER);
    const cruising = await vrf(opened.advanced, 0);
    await testClient.mine({ blocks: Number(ACTION_TIMEOUT_BLOCKS) + 1 });
    const forfeited = await run(await host.write.forfeitExpiredSession([cruising.advanced.session]));
    expect(forfeited.settled.phase).to.equal(Phase.FORFEITED);
    const ejectValue = (WAGER * 196n) / 100n;
    expect(forfeited.settled.payout).to.equal((ejectValue * 9n) / 10n);
    const after = await balances();
    expect(after.player).to.equal(before.player - WAGER + (ejectValue * 9n) / 10n);
  });
});
