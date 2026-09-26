import React, { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Target } from 'lucide-react';
import { CLEAR_BONUS_XP, type MissionBoard } from '../lib/missions';

/** Time until local midnight as "5h 12m", refreshed every half minute. */
function useResetCountdown() {
  const compute = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const minutes = Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 60000));
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  };
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    const id = setInterval(() => setLeft(compute()), 30_000);
    return () => clearInterval(id);
  }, []);
  return left;
}

export function MissionsPanel({ board }: { board: MissionBoard }) {
  const resetIn = useResetCountdown();
  const done = board.missions.filter(m => m.done).length;
  return (
    <div className="rounded-xl border border-hull-700 bg-hull-850/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] tracking-widest text-hull-400">
        <Target className="w-3.5 h-3.5 text-flare-300" /> DAILY MISSIONS
        <span className="text-flare-300 tracking-normal">
          {done}/{board.missions.length}
        </span>
        <span className="ml-auto tracking-normal text-[10px] text-hull-600">new in {resetIn}</span>
      </div>
      <ul className="mt-2 space-y-2">
        {board.missions.map(m => (
          <li key={m.id}>
            <div className="flex items-center gap-2 text-xs">
              {m.done ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-mint-400" /> : <Circle className="w-3.5 h-3.5 shrink-0 text-hull-600" />}
              <span className={`truncate ${m.done ? 'text-hull-400 line-through' : 'text-hull-100'}`}>{m.title}</span>
              <span className={`ml-auto shrink-0 text-[10px] font-semibold ${m.done ? 'text-mint-400' : 'text-flare-300'}`}>+{m.xp} XP</span>
            </div>
            {m.target > 1 && (
              <div className="mt-1 ml-5 flex items-center gap-2">
                <div className="flex-1 h-1 rounded-full bg-hull-800 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-nebula-500 to-flare-400 transition-all duration-500" style={{ width: `${(m.progress / m.target) * 100}%` }} />
                </div>
                <span className="text-[10px] tabular-nums text-hull-400">
                  {m.progress}/{m.target}
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className={`mt-2 text-[10px] ${board.clearedBonus ? 'text-mint-300' : 'text-hull-400'}`}>
        {board.clearedBonus ? `All clear today: +${CLEAR_BONUS_XP} XP bonus earned` : `Clear all three for a +${CLEAR_BONUS_XP} XP bonus`}
      </div>
    </div>
  );
}
