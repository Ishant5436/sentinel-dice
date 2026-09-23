# SentinelDice Protocol

Provably fair on-chain 2d6 cyber defense dice protocol implementing `ICasinoGameV2` on Base. Built for Chain Jam Vol. 1.

## Architecture Overview

SentinelDice is an institutional-grade on-chain gaming protocol developed under Deterministic Safety Standards. It integrates directly with the chain.wtf diamond casino host, consuming cryptographically verified randomness from the Verify Network VRF provider and resolving bets in a single deterministic settlement step.

```
                      +-----------------------------+
                      |   Chain.wtf Diamond Host    |
                      |      (CasinoGameFacet)      |
                      +--------------+--------------+
                                     |
               quoteCaps / quoteRiskParams / onSessionStart
                                     |
                                     v
                      +-----------------------------+
                      |      SentinelDice.sol       |
                      |       (ICasinoGameV2)       |
                      +--------------+--------------+
                                     |
                      Verify Network VRF (bytes32)
                                     |
                                     v
                   Canonical Rejection Sampler (d1, d2)
                      (DIE_REJECT = 252, DIE_FACES = 6)
                                     |
                                     v
                      +-----------------------------+
                      |   Deterministic Settlement  |
                      |   (payout <= escrow + res)  |
                      +-----------------------------+
```

## Mathematical Model & Fair Randomness

### Canonical Rejection Sampling
Standard naive modulo mapping `(randomness[i] % 6) + 1` introduces a systematic 0.39% bias favoring faces 1 through 4 because $256 \pmod 6 = 4$.

SentinelDice enforces canonical rejection sampling directly on the VRF entropy stream:
1. Rejection Threshold: $\text{DIE\_REJECT} = 252 = 42 \times 6$.
2. Valid Byte Range: Bytes $b \in [0, 251]$ map uniformly to faces $(b \pmod 6) + 1$.
3. Cursor Threading: Dice $d_1$ and $d_2$ consume sequential valid bytes across the 32-byte VRF word.
4. Entropy Expansion: If the cursor reaches the 32-byte boundary, the seed is expanded via $\text{keccak256}(\text{seed})$ with a hard deterministic bound of 8 rehash attempts.

### Combinatorics & Return to Player (RTP)
Let $S = d_1 + d_2 \in [2, 12]$. The total sample space contains $|\Omega| = 36$ equally probable outcomes.

The protocol operates at a fixed Return to Player of 98.00% ($\text{RTP\_BPS} = 9800$, $\text{BASIS\_POINTS} = 10000$).
$$\text{payout} = \frac{\text{wager} \times \text{RTP\_BPS} \times 36}{\text{BASIS\_POINTS} \times \text{winningWays}}$$

### Supported Bet Modes
1. **Under Target:** Win if $S < \text{targetSum}$ where $\text{targetSum} \in [3, 12]$.
2. **Over Target:** Win if $S > \text{targetSum}$ where $\text{targetSum} \in [2, 11]$.
3. **Exact Target:** Win if $S = \text{targetSum}$ where $\text{targetSum} \in [2, 12]$.
4. **Doubles:** Win if $d_1 = d_2$ (6 ways, payout $5.88\times$).
5. **Even / Odd:** Win if $S \pmod 2 = 0$ or $1$ (18 ways each, payout $1.96\times$).

## Deterministic Safety Standards Compliance

The Solidity contracts strictly adhere to high-integrity invariants:
- **Function Bounding:** Every function is strictly bounded to $\le 60$ lines of code.
- **Assertion Density:** Every function enforces a minimum assertion/check density of $\ge 2$.
- **No Dynamic Memory on Hot Path:** Zero dynamic memory allocations or variable-length heap expansions during execution.
- **Bounded Loops:** Randomness sampling is bounded by a maximum of 8 rehash attempts to prevent gas depletion.
- **Settlement Delta Invariant:** Returns zero `reservedProfitDelta` on `SessionPhase.SETTLED` to eliminate cap truncation vulnerabilities.

## Verification & Test Suite

The test suite validates contract invariants, wei identity, and rejection sampling across Hardhat and viem:

```bash
# Install dependencies
pnpm install

# Compile contracts
npx hardhat compile

# Run deterministic safety invariant audit
python3 scripts/audit_safety_invariants.py

# Run comprehensive test suite
npx hardhat test test/SentinelDice.test.ts

# Build static production bundle
npx vite build
```

## Repository Structure

```
sentinel-dice/
├── contracts/
│   ├── ICasinoGameV2.sol      # Official chain.wtf casino game interface
│   └── SentinelDice.sol       # Production implementation with rejection sampling
├── test/
│   └── SentinelDice.test.ts   # 8-stage verification test suite
├── scripts/
│   └── audit_safety_invariants.py # AST invariant auditor
├── src/
│   ├── lib/
│   │   ├── dice.ts            # Client-side math and ABI codecs
│   │   └── useCasinoHost.ts   # Penpal guest bridge hook
│   ├── App.tsx                # Tactical cyber interface
│   └── main.tsx               # Root entrypoint
├── public/
│   └── game.manifest.json     # Chain.wtf host manifest
└── hardhat.config.cjs         # Hardhat configuration (Base / Hardhat)
```

## License
MIT License.
