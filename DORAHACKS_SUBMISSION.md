# DoraHacks BUIDL Submission: Gravity Slingshot Protocol

## Basic Information
- **Project Name:** Gravity Slingshot Protocol
- **Tagline:** Grand Tour: a press-your-luck route builder. Chain up to four gravity assists, bank between legs, up to 1003.52x, 98.00% RTP on every route (`ICasinoGameV2` multi-step)
- **Hackathon:** Chain Jam Vol. 1 ($1,000 USDC + 25% Lifetime Revenue Share)
- **Ecosystem:** Base Network / EVM / Chain.wtf
- **Repository:** https://github.com/Ishant5436/sentinel-dice
- **Live Deployment:** https://ishant5436.github.io/sentinel-dice/
- **License:** MIT License
- **Official Jam Submission ID:** `j577fmrzfk3t56fqmavn612nax8f2pgz` (Status: `ACCEPTED` at https://jam.chain.wtf/#submit)
- **DoraHacks BUIDL Profile:** #49107 (SentinelDice Protocol)

---

## Executive Summary

Gravity Slingshot: Grand Tour is a multi-step casino game built on the chain.wtf `ICasinoGameV2`
standard. The player flies a probe through up to four gravity assists, picking the body for each
leg: the Moon (80% survive, 1.25x), Jupiter (50%, 2x), a Pulsar (25%, 4x) or a Black hole (12.5%, 8x).
The probe can never
slingshot the body it just left. After every surviving assist the player ejects to bank the tour
value or burns onward, and every leg draws fresh on-chain VRF randomness.

Every leg is a fair bet (survive x multiplier = 1) and the 2% edge is applied once at settlement
(`payout = wager x product x 0.98`), so the expected return is exactly **98.00% for every route and
every eject point**. The top route pays 1003.52x (1 in 1024).

## Technical Architecture

### 1. ICasinoGameV2 multi-step session (`contracts/GravitySlingshot.sol`)
- `quoteCaps` / `quoteRiskParams`: reserve and risk inputs for the best route reachable from the
  chosen first body (313.6x from the Moon up to 1003.52x from the Pulsar or Black hole). `probabilityWad` is the top route's
  probability; `bodyVarianceScaled` is an upper bound over all strategies.
- `onSessionStart`: launches leg 1 (`WAITING_RANDOMNESS`) and commits the full reserve.
- `onRandomness`: resolves the leg by rejection-sampled roll; captured settles at 0, the fourth
  survived leg settles at the tour value, otherwise the session waits for the player.
- `onPlayerAction`: `LAUNCH(body)` requests fresh randomness for the next leg; `EJECT` settles.
  Settling steps return zero escrow and reserve deltas.
- `quoteForfeitPayout`: the eject value between legs, 0 while a leg is in flight. The facet pays
  90% of it on forfeit, which is always worse than ejecting.
- A single payout function backs every quote and settlement, so the top route pays exactly the
  committed cap.

### 2. Zero modulo bias
Each leg maps the 256-bit VRF word to `[0, 9999]` by rejection sampling with a bounded re-hash
loop (at most 8 attempts), then survives when `roll < 8000 / 5000 / 2500 / 1250`.

### 3. Verification
- `npm test`: 27 passing. This includes an exhaustive check of all 160 legal strategies (every route
  x every eject point) through the contract's real step functions, asserting 98.00% expected return
  in exact integer arithmetic, and end-to-end runs through the casino-sdk `LocalCasinoHost`
  (bust, eject, full 1003.52x tour, rejected repeat body, forfeit).
- `node scripts/monte-carlo.ts`: empirical RTP per strategy, driven by the same state machine as
  the UI.
- Played end to end in the casino-sdk local simulator (open, per-leg VRF, burn, eject, payout).

### 4. Frontend
- React + Canvas stage with a persistent render loop: approach, periapsis hold while the VRF
  resolves, then slingshot exit or capture spiral.
- The Moon, Jupiter, the Pulsar and the Black hole are rendered in Blender (procedural Cycles
  shaders, `scripts/blender/`) as 36-frame spin loops; the gallery og:image is a Blender render too.
- Procedural Web Audio cues, keyboard controls, host session resume, and a standalone demo mode.
- Chain Jam widget preserved: `<script async src="https://jam.chain.wtf/widget.js"></script>`.
