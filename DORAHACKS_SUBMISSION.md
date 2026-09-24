# DoraHacks BUIDL Submission: Gravity Slingshot Protocol

## Basic Information
- **Project Name:** Gravity Slingshot Protocol
- **Tagline:** Provably Fair Astrodynamic Orbital Mechanics Casino Protocol on Base (`ICasinoGameV2`)
- **Hackathon:** Chain Jam Vol. 1 ($1,000 USDC + 25% Lifetime Revenue Share)
- **Ecosystem:** Base Network / EVM / Chain.wtf
- **Repository:** https://github.com/Ishant5436/sentinel-dice
- **Live Deployment:** https://ishant5436.github.io/sentinel-dice/
- **License:** MIT License

---

## Executive Summary

Gravity Slingshot is a novel astrodynamic orbital mechanics casino protocol built on Base specifically for Chain Jam Vol. 1 adhering to the official chain.wtf `ICasinoGameV2` standard.

Replacing predictable classic casino copies and retail originals (banned under Section 03 of the Chain Jam rules), Gravity Slingshot lets players pilot an interstellar deep-space reconnaissance probe on a high-velocity hyperbolic trajectory around a massive celestial singularity (Jovian Gas Giant, Pulsar PSR-01, or Singularity Gargantua).

The player calibrates their **Periapsis Proximity** (closest approach distance to the singularity):
- **Closer Approach (High Risk / High Multiplier):** Exponential velocity increase upon escape, but narrower survival corridor before gravitational tidal forces pull the probe past the event horizon.
- **Distant Approach (Low Risk / Low Multiplier):** Wide survival corridor, gentle trajectory deflection, safe modest return.

The protocol operates at a mathematically proven **98.00% Return to Player (RTP)** with closed-form pricing across continuous risk ratings from 1.00% to 98.00% win probability ($1.00\times$ to $98.00\times$ multiplier).

---

## Technical Architecture

### 1. ICasinoGameV2 Contract Compliance (`contracts/GravitySlingshot.sol`)
Gravity Slingshot implements all required lifecycle methods defined by the chain.wtf diamond host:
- `quoteCaps(wager, gameData)`: Calculates exact escrow requirements and maximum reserved profit for vault liquidity checks.
- `quoteRiskParams(wager, gameData)`: Computes maximum payout, probability in WAD, expected payout, and body variance for portfolio Value-at-Risk (VaR) accounting.
- `onSessionStart(ctx)`: Requests VRF entropy from the host and commits reserved profit.
- `onRandomness(ctx, randomness)`: Evaluates escape trajectories via unbiased rejection sampling and returns deterministic settlement with zero `reservedProfitDelta`.
- `quoteForfeitPayout(ctx)`: Returns zero to eliminate adverse-selection exploits against the vault on atomic games.

### 2. Zero Modulo Bias via Rejection Sampling
Mapping raw 256-bit entropy directly to continuous basis points ($[0, 9999]$) via naive modulo creates asymmetric bias because $2^{256} \pmod{10000} \neq 0$.

Gravity Slingshot enforces canonical rejection sampling:
```solidity
uint256 limit = type(uint256).max - (type(uint256).max % BASIS_POINTS);
for (uint256 attempt = 0; attempt < MAX_REHASH_ATTEMPTS; attempt++) {
  if (sample < limit) {
    rollBps = uint16(sample % BASIS_POINTS);
    return rollBps;
  }
  sample = uint256(keccak256(abi.encodePacked(seed, attempt)));
}
```

### 3. Deterministic Safety Standards Compliance
The contract adheres to mission-critical engineering invariants:
- **Function Bounding:** Every function strictly bounded to $\le 60$ lines of code.
- **Assertion Density:** Every function enforces a minimum assertion/check density of $\ge 2$.
- **Zero Dynamic Memory on Hot Path:** Zero dynamic allocations during session execution.
- **Bounded Loops:** Sampling bounded to a maximum of 8 rehash attempts.
- **Static Invariant Audit:** Verified by automated AST script (`scripts/audit_safety_invariants.py`).

### 4. 60 FPS Canvas Physics & Procedural Web Audio Engine
- **HTML5 Canvas:** Real-time 2D Verlet numerical trajectory integration, particle ion thruster plumes, relativistic magnetic beam jets, and black hole gravitational photon rings.
- **Web Audio API:** Zero external audio assets; procedurally synthesizes relativistic Doppler sweeps (160 Hz $\to$ 720 Hz), gravity well hums (55 Hz), escape harmonic chords, and sub-bass singularity implosions.
- **Tracking Widget:** Preserves official Chain Jam script `<script async src="https://jam.chain.wtf/widget.js"></script>`.
