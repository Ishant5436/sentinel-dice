# Gravity Slingshot — Provably Fair Astrodynamic Casino Protocol

[![Solidity](https://img.shields.io/badge/Solidity-^0.8.30-363636?logo=solidity)](contracts/GravitySlingshot.sol)
[![ICasinoGameV2](https://img.shields.io/badge/Interface-ICasinoGameV2-blue)](contracts/ICasinoGameV2.sol)
[![RTP](https://img.shields.io/badge/Theoretical%20RTP-98.00%25-brightgreen)](contracts/GravitySlingshot.sol)
[![Framework](https://img.shields.io/badge/Engine-Vite%20%7C%20React%20%7C%20Canvas-61DAFB)](src/App.tsx)
[![Chain Jam](https://img.shields.io/badge/Chain%20Jam-Vol.%201%20Entry-blueviolet)](https://jam.chain.wtf)

**Gravity Slingshot** is a novel astrodynamic orbital-assist casino game built on Base for **Chain Jam Vol. 1** ($5,000 USDC Prize Pool + 25% Lifetime Revenue Share).

Replacing predictable classic casino copies and retail originals (banned under Section 03 of the Chain Jam rules), Gravity Slingshot lets players pilot an interstellar deep-space reconnaissance probe on a high-velocity hyperbolic trajectory around a massive celestial singularity (Jovian Gas Giant, Pulsar PSR-01, or Singularity Gargantua).

---

## 1. Core Mechanics & Astrodynamic Lore

The player calibrates their **Periapsis Proximity** (closest approach distance to the singularity):
- **Closer Approach (High Risk / High Multiplier):** Exponential velocity increase upon escape, but narrower survival corridor before gravitational tidal forces pull the probe past the event horizon.
- **Distant Approach (Low Risk / Low Multiplier):** Wide survival corridor, gentle trajectory deflection, safe modest return.

### Celestial Destinations
1. **Jovian Vortex (Jupiter-Class Gas Giant):** Radiation belts and atmospheric drag.
2. **Pulsar PSR-01 (Neutron Star):** Relativistic magnetic jets and high-frequency rotational pulses.
3. **Singularity Gargantua (Kerr Black Hole):** Relativistic accretion disk, gravitational photon sphere, and warped spacetime lensing.

---

## 2. Provably Fair Astrodynamic Math

### Exact 98.00% Return to Player (RTP)
The smart contract enforces a constant **98.00% RTP** across all continuous risk ratings:
$$\text{RTP} \equiv 98.00\% = 0.98$$

Let $K \in [100, 9800]$ be the target win probability in basis points ($100 = 1.00\%$, $9800 = 98.00\%$):
$$P(\text{Escape}) = \frac{K}{10000}$$
$$\text{Multiplier} = \frac{9800}{K}$$
$$\text{Payout} = \frac{\text{Wager} \times 9800}{K}$$

**Expected Return:**
$$\mathbb{E}[\text{Payout}] = P(\text{Escape}) \times \text{Payout} = \left(\frac{K}{10000}\right) \times \left(\frac{\text{Wager} \times 9800}{K}\right) = 0.98 \times \text{Wager}$$

### Zero Modulo Bias (Rejection Sampling)
The contract rejects bias when scaling 256 bits of cryptographic entropy to $[0, 9999]$:
- Range span: $S = 10000$.
- Rejection limit: $\text{LIMIT} = 2^{256} - (2^{256} \pmod{10000})$.
- Any sample $\ge \text{LIMIT}$ triggers a deterministic re-hash: $\text{keccak256}(\text{entropy}, \text{attempt})$.
- Once accepted, $\text{roll} = \text{sample} \pmod{10000}$.
- If $\text{roll} < K \implies \textbf{ESCAPE (WIN)}$. Else $\implies \textbf{CAPTURE (LOSS)}$.

---

## 3. Architecture & Safety Invariants

- **Interface:** Implements `ICasinoGameV2` (`quoteCaps`, `quoteRiskParams`, `onSessionStart`, `onRandomness`, `quoteForfeitPayout`).
- **Safety Standard:** Conforms to Deterministic Safety Standards:
  - Bounded loops (maximum 8 rehash attempts).
  - All functions $\le 60$ lines.
  - Assertion density $\ge 2$ checks per function.
- **Frontend Engine:**
  - 60 FPS HTML5 Canvas with 2D Verlet numerical trajectory integration.
  - Zero-dependency procedural Web Audio API synthesizer (Doppler frequency sweeps, gravitational hum, sonic boom, and sub-bass implosion).
  - Chain Jam SDK widget integrated: `<script async src="https://jam.chain.wtf/widget.js"></script>`.

---

## 4. Verification & Testing

```bash
# Compile smart contracts
npx hardhat compile

# Run complete test suite (19 passing)
npx hardhat test

# Build production bundle
npm run build
```
