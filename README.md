# Gravity Slingshot: Grand Tour

[![Solidity](https://img.shields.io/badge/Solidity-^0.8.30-363636?logo=solidity)](contracts/GravitySlingshot.sol)
[![ICasinoGameV2](https://img.shields.io/badge/Interface-ICasinoGameV2%20multi--step-blue)](contracts/ICasinoGameV2.sol)
[![RTP](https://img.shields.io/badge/RTP-98.00%25%20on%20every%20strategy-brightgreen)](test/GravitySlingshot.test.ts)
[![Chain Jam](https://img.shields.io/badge/Chain%20Jam-Vol.%201%20Entry-blueviolet)](https://jam.chain.wtf)

A press-your-luck **route builder** for Chain Jam Vol. 1. You fly a probe through up to four
gravity assists. Before each leg you pick the body to slingshot around. Survive and your tour
value multiplies, then you choose: **eject** and bank it, or **burn onward** to the next body.
Every leg draws fresh on-chain VRF randomness, and you can never slingshot the body you just left,
so every tour is a small routing puzzle.

Live: https://ishant5436.github.io/sentinel-dice/

## How it plays

| Body    | Survive | Leg multiplier | Survive x multiplier |
| ------- | ------- | -------------- | -------------------- |
| Moon    | 80%     | 1.25x          | 1.00                 |
| Jupiter | 50%     | 2x             | 1.00                 |
| Pulsar  | 25%     | 4x             | 1.00                 |
| Black hole | 12.5% | 8x            | 1.00                 |

1. Pick a first body and a wager, then launch. Opening the session launches leg 1.
2. After a surviving assist the tour value is the product of the leg multipliers so far.
3. Eject to bank `wager x tour value x 0.98`, or burn onward to any body except the one you just left.
4. Survive all four legs and the tour settles automatically. A failed roll captures the probe (payout 0).

The best route is Pulsar, Black hole, Pulsar, Black hole (or Black hole, Pulsar, Black hole, Pulsar):
1024x gross, **1003.52x paid**, a 1 in 1024 shot. Zig-zagging the Moon and Jupiter is the steady play.

## Why the RTP is exactly 98% whatever you do

Every leg is a fair bet (survive probability x multiplier = 1), so the tour value is a
martingale: no route and no stopping rule changes its expected value. The 2% house edge is
applied **once**, at settlement:

```
payout = wager x (product of leg multipliers) x 0.98
E[payout] = 0.98 x wager        for every route and every eject point
```

Applying the edge per leg instead would compound to 0.98^n and punish longer tours. Here your
choices change only the variance, never the edge.

Because busting ends the tour, a strategy can only condition on "survived so far", so every
strategy is a fixed route plus an eject point. There are exactly 160 of them, and
`test/GravitySlingshot.test.ts` walks every one through the contract's real step functions and
checks `E[payout] = 0.98 x wager` in exact integer arithmetic.

Monte Carlo illustration (`node scripts/monte-carlo.ts 2000000`, same state machine as the UI):

```
strategy                                       RTP %   +/- 2SE     win %    best x
Pulsar once, eject                             98.09      0.24     25.02      3.92
Moon x4 zigzag (M J M J)                       98.24      0.32     16.04      6.12
Jupiter then Pulsar, eject                     98.05      0.37     12.51      7.84
Pulsar-Jupiter loop (P J P J)                  97.48      1.10      1.55     62.72
Black hole once, eject                         97.87      0.37     12.48      7.84
Grand Tour max (P B P B)                       99.95      4.48      0.10   1003.52
Chaos pilot (random bodies, 30% eject)         98.59      1.08     17.37   1003.52
```

## On-chain design (`contracts/GravitySlingshot.sol`)

Multi-step `ICasinoGameV2` session:

```
openSession(gameData = abi.encode(uint8 firstBody))
  onSessionStart   -> WAITING_RANDOMNESS (leg 1 launched), commits the full reserve
  onRandomness     -> captured: SETTLED, payout 0
                   -> survived leg 4: SETTLED, payout = tour value x 0.98
                   -> otherwise: WAITING_PLAYER_ACTION
submitAction(actionData = abi.encode(uint8 action, uint8 body))
  LAUNCH(body)     -> WAITING_RANDOMNESS (fresh VRF for the new leg)
  EJECT            -> SETTLED, payout = tour value x 0.98
```

- **One payout function** (`tourPayout`) backs `quoteCaps`, `quoteRiskParams`, eject, completion
  and `quoteForfeitPayout`. Multipliers are exact fractions (Moon = 5/4) with a single floor
  division, so the top route pays exactly the reserve committed at open, never a wei more.
- **Reserve:** `onSessionStart` commits `maxPayout - wager` for the best route reachable from the
  chosen first body (313.6x from the Moon, 501.76x from Jupiter, 1003.52x from the Pulsar or the Black
  hole). Settling steps return zero escrow and
  reserve deltas, as the SDK requires.
- **Forfeit:** `quoteForfeitPayout` returns the eject value while the player is between legs and 0
  while a leg is in flight. The value is fully determined by revealed state, and the facet pays 90%
  of it, which is always worse than ejecting, so abandoning a tour is never an edge.
- **Risk params:** `probabilityWad` is the top route's probability (1/320 to 1/1024). The body
  variance is an upper bound over all strategies: for a fixed route E[M^2] equals the product of its
  multipliers, and the largest product among routes that never pay the top tier is 160, 256 or 512
  depending on the first body (`nonTopSecondMoment`, checked against brute force in the tests).
- **Randomness:** each leg maps the VRF word to a roll in [0, 9999] by rejection sampling (no modulo
  bias). A leg survives when `roll < 8000 / 5000 / 2500 / 1250`.

## Verification

```bash
npm test                              # 27 passing
node scripts/monte-carlo.ts 1000000   # empirical RTP per strategy
npm run build
```

- `test/GravitySlingshot.test.ts`: paytable, quotes, state machine, route rule, phase guards and
  the exhaustive 160-strategy RTP check.
- `test/GrandTour.host.test.ts`: end to end through the casino-sdk `LocalCasinoHost` (the
  simulator's stand-in for the production facet): bust, eject, a full 1003.52x tour that pays
  exactly the committed cap, a rejected repeat body, and a forfeit at 90% of the eject value.
- The contract drops into the casino-sdk local simulator unchanged (no constructor arguments,
  imports only `./ICasinoGameV2.sol`); play it at `http://localhost:3300/?game=<this app>&gameAddress=<deployed>`.

## Frontend

- React + Canvas. The render loop persists across state changes, so each leg animates the
  approach, a periapsis hold while the VRF resolves, then a slingshot exit or a capture spiral.
- The Moon, Jupiter, the Pulsar and the Black hole (accretion disk with Doppler beaming, lensed
  halo, photon ring) are rendered in Blender (Cycles, fully procedural shaders) as 36-frame spin
  loops and crossfaded on the canvas. Rebuild them with:
  `blender -b --python scripts/blender/render_bodies.py -- /tmp/render 36 && scripts/blender/build_sheets.sh /tmp/render`
- The gallery card (`public/og-image.png`, 1200x630) is a Blender render of all four bodies:
  `blender -b --python scripts/blender/render_cover.py -- /tmp/cover.png && scripts/blender/finish_cover.sh /tmp/cover.png`
- Interface palette ("Event Horizon") lives in `tailwind.config.cjs` as the `hull`, `flare`,
  `nebula`, `mint` and `ember` tokens; the game canvas keeps its own colors.
- The UI state mirrors the contract (`src/lib/slingshot.ts`). In the host it follows the session
  snapshots and resumes an open tour after a reload. Standalone it runs a demo with Web Crypto
  rolls and a play balance.
- Keyboard: `1` to `4` pick or burn a body, `E` ejects, `Enter` launches.
- Chain Jam widget: `<script async src="https://jam.chain.wtf/widget.js"></script>` in `index.html`.
