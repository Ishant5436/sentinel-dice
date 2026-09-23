# DoraHacks BUIDL Submission: SentinelDice Protocol

## Basic Information
- **Project Name:** SentinelDice Protocol
- **Tagline:** Provably Fair 2d6 Cyber Defense Dice Protocol on Base (`ICasinoGameV2`)
- **Hackathon:** Chain Jam Vol. 1 ($1,000 USDC + 25% Revenue Share)
- **Ecosystem:** Base Network / EVM / Chain.wtf
- **Repository:** https://github.com/Ishant5436/sentinel-dice
- **License:** MIT License

---

## Executive Summary
SentinelDice is an on-chain 2d6 game protocol built specifically for Chain Jam Vol. 1 adhering to the official chain.wtf `ICasinoGameV2` standard. 

Unlike standard implementations that suffer from modulo bias when mapping raw byte streams to 6-sided dice, SentinelDice enforces canonical rejection sampling directly on Verify Network VRF randomness (`DIE_REJECT = 252`, `DIE_FACES = 6`) to guarantee uniform probability distributions across all outcomes. The protocol operates at a mathematically proven 98.00% Return to Player (RTP) with closed-form combinatorial pricing across 6 tactical bet modes: Under, Over, Exact Sum, Doubles, Even, and Odd.

---

## Technical Architecture

### 1. ICasinoGameV2 Contract Compliance
SentinelDice implements all required lifecycle methods defined by the chain.wtf diamond host:
- `quoteCaps(wager, gameData)`: Calculates exact escrow requirements and maximum reserved profit for vault liquidity checks.
- `quoteRiskParams(wager, gameData)`: Computes maximum payout, probability in WAD, expected payout, and body variance for portfolio Value-at-Risk (VaR) accounting.
- `onSessionStart(ctx)`: Requests VRF entropy from the host and commits reserved profit.
- `onRandomness(ctx, randomness)`: Maps 256-bit entropy to unbiased 2d6 faces, evaluates win conditions, and returns deterministic settlement with zero `reservedProfitDelta` (preventing payout cap truncation).
- `quoteForfeitPayout(ctx)`: Returns zero to eliminate adverse-selection exploits against the vault on atomic games.

### 2. Canonical Rejection Sampling & Bias Elimination
Mapping uniform bytes ($[0, 255]$) directly to dice faces ($1..6$) via naive modulo creates an asymmetric bias because $256 \pmod 6 = 4$, making faces 1 to 4 ~0.39 percentage points more likely than faces 5 and 6.

SentinelDice implements canonical rejection sampling:
```solidity
uint8 internal constant DIE_FACES = 6;
uint8 internal constant DIE_REJECT = 252; // 42 * 6

// Rejection sampling loop
while (attempts < MAX_REHASH_ATTEMPTS) {
  if (nextIdx < 32) {
    uint8 b = uint8(nextSeed[nextIdx]);
    nextIdx++;
    if (b < DIE_REJECT) {
      die = (b % DIE_FACES) + 1;
      return (die, nextIdx, nextSeed);
    }
    continue;
  }
  nextSeed = keccak256(abi.encodePacked(nextSeed));
  nextIdx = 0;
  attempts++;
}
```

### 3. Deterministic Safety Standards Compliance
The contract adheres to mission-critical engineering invariants:
- **Function Bounding:** Every function strictly bounded to $\le 60$ lines of code.
- **Assertion Density:** Every function enforces a minimum assertion/check density of $\ge 2$.
- **Zero Dynamic Memory on Hot Path:** Zero dynamic allocations during session execution.
- **Bounded Loops:** Sampling bounded to a maximum of 8 rehash attempts.

---

## Verification & Quality Assurance Evidence

The test suite runs against Hardhat and viem, validating:
1. Combinatorial accuracy across all 36 combinations of 2d6 sums.
2. Exact 1-wei identity between `quoteCaps`, `quoteRiskParams`, and `onRandomness` settlement payouts.
3. Zero `reservedProfitDelta` on the settling step.
4. Deterministic rejection sampling behavior across simulated VRF entropy streams.

### Test Results
```
  SentinelDice Protocol Tests
    Math & Combinatorics Verification
      ✔ computes exact combinatorial winning ways for all sum combinations
      ✔ reverts on out-of-bounds targetSum for bet types
    quoteCaps & quoteRiskParams Exact Wei Agreement
      ✔ guarantees 1-wei identity between quoteCaps maxPayout and expected payout
    Session Lifecycle Verification
      ✔ returns correct StepResult on onSessionStart
      ✔ verifies onRandomness settles with zero reservedProfitDelta and exact payout
      ✔ verifies quoteForfeitPayout returns 0
      ✔ rejects onPlayerAction as game resolves atomically on randomness
    Rejection Sampling Uniformity & Boundary Invariants
      ✔ ensures all simulated rolls produce valid faces in [1, 6] across 100 seeds

  8 passing (484ms)
```

---

## Web Interface & Diamond Host Penpal Bridge
The frontend is built using React 19, Vite, and Tailwind CSS. It communicates with the chain.wtf Diamond Host through an iframe Penpal RPC handshake (`@chain/casino-sdk/guest`), supporting:
- Full responsive iframe scaling via `observeGameContentSize`.
- Dynamic combinatorics calculation: displays live win probability, payout multiplier, and potential returns as sliders adjust.
- Verified local preview mode for stand-alone testing.
