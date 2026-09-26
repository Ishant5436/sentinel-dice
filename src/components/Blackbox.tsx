import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { BODIES, TourStatus, flownRoute, routeMultiplier, routeSurvival, type Tour } from '../lib/slingshot';
import { paidMultiplier } from '../lib/flight';

/**
 * Collapsible provably-fair drawer: for each resolved leg, the VRF word, the survival gate and the
 * roll the contract derived from it, plus the expected-value identity for the flown route.
 */
export function Blackbox({
  tour,
  words,
  demo,
  onVerify,
}: {
  tour: Tour | null;
  words: Array<string | undefined>;
  demo: boolean;
  onVerify?: () => Promise<string>;
}) {
  const [verdict, setVerdict] = useState<string | null>(null);
  const route = tour ? flownRoute(tour) : [];
  const resolved = tour ? (tour.status === TourStatus.BURNING ? tour.legs - 1 : tour.legs) : 0;
  const p = routeSurvival(route);
  const m = routeMultiplier(route);
  const edgeFactor = route.length ? paidMultiplier(route) / m : 0;

  return (
    <details className="group rounded-xl border border-hull-700 bg-hull-850/60 p-3">
      <summary className="flex items-center gap-1.5 text-[11px] tracking-widest text-hull-400 cursor-pointer select-none list-none">
        <ShieldCheck className="w-3.5 h-3.5 text-mint-400" /> FLIGHT BLACKBOX
        <span className="ml-auto text-[10px] tracking-normal text-hull-600 group-open:hidden">provably fair, tap to open</span>
      </summary>
      {!tour ? (
        <div className="mt-2 text-xs text-hull-600">Fly a leg to record its randomness here.</div>
      ) : (
        <div className="mt-2 space-y-2 text-[11px]">
          <table className="w-full tabular-nums">
            <thead>
              <tr className="text-hull-600 text-left">
                <th className="font-normal">LEG</th>
                <th className="font-normal">GATE</th>
                <th className="font-normal">ROLL</th>
                <th className="font-normal text-right">RESULT</th>
              </tr>
            </thead>
            <tbody>
              {route.map((body, i) => {
                const gate = BODIES[body].surviveBps;
                const done = i < resolved;
                const roll = tour.rolls[i];
                return (
                  <tr key={i} className="align-top">
                    <td className="py-0.5 text-hull-300">
                      {i + 1}. {BODIES[body].name}
                      <div className="text-[9px] text-hull-600 font-mono break-all">
                        {words[i] ? `${words[i]!.slice(0, 18)}...` : demo ? 'demo: Web Crypto roll' : done ? 'VRF word syncing' : 'in flight'}
                      </div>
                    </td>
                    <td className="py-0.5 text-hull-400">&lt; {gate}</td>
                    <td className="py-0.5 text-hull-100">{done ? roll : '--'}</td>
                    <td className={`py-0.5 text-right font-semibold ${!done ? 'text-cyan-300' : roll < gate ? 'text-mint-400' : 'text-ember-400'}`}>
                      {!done ? 'PENDING' : roll < gate ? 'SURVIVED' : 'CAPTURED'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rounded-lg bg-hull-950/70 border border-hull-700 p-2 font-mono text-[10px] text-hull-300 space-y-0.5">
            <div>roll = VRF word mod 10000 (rejection sampled, no modulo bias)</div>
            <div>
              P(route) = {route.map(b => (BODIES[b].surviveBps / 10000).toFixed(3)).join(' x ')} = {p.toPrecision(4)}
            </div>
            <div>
              M(route) = {route.map(b => BODIES[b].multLabel).join(' x ')} = {m.toFixed(2)}
            </div>
            <div className="text-mint-300">
              E[payout] = P x M x {edgeFactor.toFixed(2)} = {(p * m * edgeFactor * 100).toFixed(2)}% of stake
            </div>
          </div>
          {onVerify && (
            <button
              onClick={() => {
                setVerdict('checking...');
                onVerify()
                  .then(setVerdict)
                  .catch((err: unknown) => setVerdict(`verification unavailable: ${err instanceof Error ? err.message : String(err)}`));
              }}
              className="w-full py-1.5 rounded-lg border border-mint-400/40 text-mint-300 hover:bg-mint-400/10"
            >
              VERIFY VRF PROOFS
            </button>
          )}
          {verdict && <div className="text-[10px] text-hull-300">{verdict}</div>}
        </div>
      )}
    </details>
  );
}
