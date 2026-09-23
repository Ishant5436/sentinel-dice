import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters, type Hex } from 'viem';

export const BASIS_POINTS = 10_000n;
export const RTP_BPS = 9_800n; // 98.00% Return to Player
export const TOTAL_COMBINATIONS = 36n;

export const BET_UNDER = 0;
export const BET_OVER = 1;
export const BET_EXACT = 2;
export const BET_EVEN = 3;
export const BET_ODD = 4;
export const BET_DOUBLES = 5;

export type BetType = 0 | 1 | 2 | 3 | 4 | 5;

export interface DiceBet {
  betType: BetType;
  targetSum: number;
}

export interface DiceOutcome {
  d1: number;
  d2: number;
  sum: number;
  won: boolean;
  payout: bigint;
}

export function waysForSum(sum: number): number {
  if (sum < 2 || sum > 12) return 0;
  if (sum <= 7) return sum - 1;
  return 13 - sum;
}

export function winningWays(betType: BetType, targetSum: number): number {
  if (betType === BET_UNDER) {
    let ways = 0;
    for (let s = 2; s < targetSum; s++) ways += waysForSum(s);
    return ways;
  }
  if (betType === BET_OVER) {
    let ways = 0;
    for (let s = targetSum + 1; s <= 12; s++) ways += waysForSum(s);
    return ways;
  }
  if (betType === BET_EXACT) {
    return waysForSum(targetSum);
  }
  if (betType === BET_EVEN || betType === BET_ODD) {
    return 18;
  }
  if (betType === BET_DOUBLES) {
    return 6;
  }
  return 0;
}

export function winProbability(betType: BetType, targetSum: number): number {
  const ways = winningWays(betType, targetSum);
  return ways / 36.0;
}

export function payoutMultiplier(betType: BetType, targetSum: number): number {
  const ways = winningWays(betType, targetSum);
  if (ways === 0) return 0;
  return (0.98 * 36) / ways;
}

export function calculatePayout(wager: bigint, ways: number): bigint {
  if (wager === 0n || ways <= 0) return 0n;
  return (wager * RTP_BPS * TOTAL_COMBINATIONS) / (BASIS_POINTS * BigInt(ways));
}

export function encodeGameData(bet: DiceBet): Hex {
  return encodeAbiParameters(parseAbiParameters('uint8, uint8'), [bet.betType, bet.targetSum]);
}

export function decodeGameState(gameState: Hex): DiceOutcome | null {
  try {
    if (!gameState || gameState === '0x') return null;
    const [d1, d2, sum, won, payout] = decodeAbiParameters(
      parseAbiParameters('uint8, uint8, uint8, bool, uint256'),
      gameState,
    );
    return {
      d1: Number(d1),
      d2: Number(d2),
      sum: Number(sum),
      won,
      payout,
    };
  } catch {
    return null;
  }
}
