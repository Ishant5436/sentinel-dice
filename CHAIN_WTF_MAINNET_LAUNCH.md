# Chain.wtf Mainnet Launch & 25% Revenue Share Binding

**Project:** Gravity Slingshot: Grand Tour  
**DoraHacks BUIDL ID:** #49107  
**Chain Jam Submission ID:** `j575wnny754wyx8rw99fkp3d2x8f5yhn`  
**Standard:** `ICasinoGameV2` (Base Mainnet, Chain ID 8453)  
**Contract Source:** [`contracts/GravitySlingshot.sol`](contracts/GravitySlingshot.sol)  
**SDK Integration:** `@chain/casino-sdk` (In-Tree Vendored at `src/casino-sdk/`)  
**Test Suite:** 34 / 34 passing tests (`pnpm test`)  
**Production Build:** Clean (`dist/` generated via `pnpm build`)  

---

## 1. Developer Credits & Registration Information

* **Claim Link:** [Discord Announcement](https://discordapp.com/channels/1491086603463168060/1514987494138187807/1569734807980605561)  
* **Discord Server:** [https://discord.gg/qVk8d7yVM](https://discord.gg/qVk8d7yVM) (`#developers-general`)  
* **Benefit:** $30 Developer Credits + 25% Lifetime Revenue Share  

---

## 2. Mainnet Deployment Command

Execute from repository root with your deployer private key (funded with dev credits):

```bash
cd /Users/ishantpanchal/sentinel-dice
export PRIVATE_KEY="0x<YOUR_PRIVATE_KEY>"
npx hardhat run scripts/deploy-gravity-slingshot.ts --network base
```

---

## 3. Developer Portal Registration Payload (`chain.wtf/dev`)

Submit the following JSON payload into the Chain.wtf Developer Portal to register the game and bind the 25% lifetime revenue share:

```json
{
  "gameId": "GravitySlingshot",
  "name": "Gravity Slingshot: Grand Tour",
  "contractAddress": "<DEPLOYED_CONTRACT_ADDRESS>",
  "network": "base",
  "standard": "ICasinoGameV2",
  "rtp": "93.00%",
  "maxMultiplier": "952.32x",
  "jamSubmissionId": "j575wnny754wyx8rw99fkp3d2x8f5yhn",
  "doraHacksBuidl": 49107,
  "manifest": {
    "version": "1.0.0",
    "entrypoint": "dist/index.html",
    "assets": "dist/assets",
    "supportedBetLimits": {
      "minBet": "0.0001 ETH",
      "maxBet": "0.1 ETH"
    }
  }
}
```

---

## 4. Verification Checkpoints

1. Contract bytecode verified on [BaseScan](https://basescan.org).
2. `ICasinoGameV2` interface compliance confirmed via unit tests.
3. In-tree SDK guest bridge (`LocalCasinoHost`) integration verified.
