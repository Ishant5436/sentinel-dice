// Monte Carlo RTP check for Grand Tour, driven through the same state machine the UI uses.
// Run: node scripts/monte-carlo.ts [roundsPerStrategy]
// The exact proof lives in test/GravitySlingshot.test.ts (all 3200 strategies, integer math);
// this is the empirical illustration that route and stopping choices never move RTP off 93%.
import {
  BODIES,
  TourStatus,
  ejectTour,
  launchLeg,
  legalNextBodies,
  resolveLeg,
  rollUniformBps,
  startTour,
  type BodyId,
  type Tour,
} from '../src/lib/slingshot.ts';

type Policy = (tour: Tour) => BodyId | 'eject';

const WAGER = 10n ** 18n;
const rounds = Number(process.argv[2] ?? 1_000_000);

const fixedRoute =
  (route: BodyId[]): Policy =>
  tour =>
    tour.legs < route.length ? route[tour.legs] : 'eject';

const randomBody = (options: BodyId[]): BodyId => options[rollUniformBps() % options.length];

const STRATEGIES: Array<{ name: string; first: () => BodyId; policy: Policy }> = [
  { name: 'Pulsar once, eject', first: () => 2, policy: fixedRoute([2]) },
  { name: 'Moon x4 zigzag (M J M J)', first: () => 0, policy: fixedRoute([0, 1, 0, 1]) },
  { name: 'Jupiter then Pulsar, eject', first: () => 1, policy: fixedRoute([1, 2]) },
  { name: 'Pulsar-Jupiter loop (P J P J)', first: () => 2, policy: fixedRoute([2, 1, 2, 1]) },
  { name: 'Black hole once, eject', first: () => 3, policy: fixedRoute([3]) },
  { name: 'Grand Tour max (P B P B)', first: () => 2, policy: fixedRoute([2, 3, 2, 3]) },
  { name: 'Comet drift (C N C N)', first: () => 4, policy: fixedRoute([4, 5, 4, 5]) },
  { name: 'Ring run (Saturn, Red giant, Saturn)', first: () => 6, policy: fixedRoute([6, 7, 6]) },
  { name: 'Red giant then Black hole, eject', first: () => 7, policy: fixedRoute([7, 3]) },
  {
    name: 'Chaos pilot (random bodies, 30% eject)',
    first: () => randomBody([0, 1, 2, 3, 4, 5, 6, 7]),
    policy: tour => (rollUniformBps() < 3000 ? 'eject' : randomBody(legalNextBodies(tour))),
  },
];

function playRound(first: BodyId, policy: Policy): bigint {
  let tour = resolveLeg(startTour(first), rollUniformBps(), WAGER);
  while (tour.status === TourStatus.CRUISING) {
    const choice = policy(tour);
    if (choice === 'eject') tour = ejectTour(tour, WAGER);
    else tour = resolveLeg(launchLeg(tour, choice), rollUniformBps(), WAGER);
  }
  return tour.payout;
}

console.log(`Grand Tour Monte Carlo, ${rounds.toLocaleString('en-US')} rounds per strategy`);
console.log(`Bodies: ${BODIES.map(b => `${b.name} ${b.surviveBps / 100}% x ${b.multLabel}`).join(', ')}\n`);
console.log('strategy'.padEnd(42), 'RTP %'.padStart(9), '+/- 2SE'.padStart(9), 'win %'.padStart(9), 'best x'.padStart(9));

for (const { name, first, policy } of STRATEGIES) {
  let paid = 0n;
  let wins = 0;
  let best = 0n;
  let sumSquares = 0;
  for (let i = 0; i < rounds; i++) {
    const payout = playRound(first(), policy);
    const x = Number(payout) / 1e18;
    sumSquares += x * x;
    paid += payout;
    if (payout > 0n) wins++;
    if (payout > best) best = payout;
  }
  const rtp = Number((paid * 1_000_000n) / (WAGER * BigInt(rounds))) / 10_000;
  const winRate = (wins / rounds) * 100;
  const bestX = Number((best * 100n) / WAGER) / 100;
  const mean = rtp / 100;
  const twoSe = 2 * Math.sqrt((sumSquares / rounds - mean * mean) / rounds) * 100;
  console.log(
    name.padEnd(42),
    rtp.toFixed(2).padStart(9),
    twoSe.toFixed(2).padStart(9),
    winRate.toFixed(2).padStart(9),
    bestX.toFixed(2).padStart(9)
  );
}
