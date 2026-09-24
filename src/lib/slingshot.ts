import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters } from 'viem';

export interface SlingshotConfig {
  riskRatingBps: number; // 100 to 9800 (1.00% to 98.00%)
  celestialId: number;   // 0: Jupiter, 1: Pulsar, 2: Gargantua
}

export interface SlingshotOutcome {
  resolved: boolean;
  escaped: boolean;
  rollBps: number;
  riskRatingBps: number;
  celestialId: number;
  payout: bigint;
}

export const RTP_BPS = 9800n;
export const BASIS_POINTS = 10000n;

export function encodeSlingshotData(config: SlingshotConfig): `0x${string}` {
  return encodeAbiParameters(
    parseAbiParameters('uint16 riskRatingBps, uint8 celestialId'),
    [config.riskRatingBps, config.celestialId]
  );
}

export function decodeSlingshotState(gameState: `0x${string}`): SlingshotOutcome | null {
  if (!gameState || gameState === '0x' || gameState.length < 10) return null;
  try {
    const [resolved, escaped, rollBps, riskRatingBps, celestialId, payout] = decodeAbiParameters(
      parseAbiParameters('bool, bool, uint16, uint16, uint8, uint256'),
      gameState
    );
    return {
      resolved,
      escaped,
      rollBps,
      riskRatingBps,
      celestialId,
      payout,
    };
  } catch (err) {
    console.error('Failed to decode slingshot state:', err);
    return null;
  }
}

export function calculateSlingshotPayout(wagerWei: bigint, riskRatingBps: number): bigint {
  if (riskRatingBps < 100 || riskRatingBps > 9800 || wagerWei === 0n) return 0n;
  return (wagerWei * RTP_BPS) / BigInt(riskRatingBps);
}

export function getMultiplier(riskRatingBps: number): number {
  if (riskRatingBps <= 0) return 0;
  return 9800 / riskRatingBps;
}

export interface RiskPreset {
  label: string;
  sublabel: string;
  riskRatingBps: number;
  multiplier: number;
  chance: number;
  color: string;
}

export const RISK_PRESETS: RiskPreset[] = [
  { label: 'Safe Orbit', sublabel: 'Low G-Force', riskRatingBps: 8000, multiplier: 1.225, chance: 80.0, color: 'text-emerald-400' },
  { label: 'Slingshot', sublabel: 'Equatorial Assist', riskRatingBps: 5000, multiplier: 1.960, chance: 50.0, color: 'text-cyan-400' },
  { label: 'Pulsar Skim', sublabel: 'Relativistic Burn', riskRatingBps: 2500, multiplier: 3.920, chance: 25.0, color: 'text-blue-400' },
  { label: 'Photon Ring', sublabel: 'Photon Sphere Dive', riskRatingBps: 1000, multiplier: 9.800, chance: 10.0, color: 'text-amber-400' },
  { label: 'Singularity', sublabel: 'Event Horizon', riskRatingBps: 200, multiplier: 49.000, chance: 2.0, color: 'text-red-400' },
];
