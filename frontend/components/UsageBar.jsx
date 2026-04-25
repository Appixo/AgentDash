'use client';

import { formatRemaining, usageBarColor, usageColorClass } from '@/lib/usage';

// Plan-usage bar. `prominent` makes the row taller, the percentage larger,
// and the over-budget warning louder — used for the Session bar so the
// Scrum Master can see at a glance whether they're about to hit the limit.
export default function UsageBar({ usage, prominent = false }) {
  const { label, percent, resetsInMs, cost, budget } = usage;
  const display = percent >= 1 ? Math.round(percent) : percent.toFixed(1);
  const overBudget = percent >= 100;

  return (
    <div className={prominent ? 'space-y-1.5 min-w-[220px]' : 'space-y-1 min-w-[160px]'}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`uppercase tracking-wider ${prominent ? 'text-[11px] text-zinc-400' : 'text-[10px] text-zinc-500'}`}>
            {label}
          </span>
          {overBudget && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/50 text-red-300 animate-pulse">
              over budget
            </span>
          )}
        </div>
        <span
          className={`tabular-nums font-semibold ${usageColorClass(percent)} ${
            prominent ? 'text-2xl' : 'text-base'
          }`}
        >
          {display}%
        </span>
      </div>

      <div
        className={`w-full bg-white/10 rounded-full overflow-hidden ${prominent ? 'h-2.5' : 'h-1.5'}`}
        title={`${cost.toFixed(2)} of ${budget.toFixed(0)} budget`}
      >
        <div
          className={`h-full ${usageBarColor(percent)} transition-all duration-500`}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>

      <div className={`flex items-baseline justify-between tabular-nums ${prominent ? 'text-[11px] text-zinc-500' : 'text-[10px] text-zinc-500'}`}>
        <span>resets in {formatRemaining(resetsInMs)}</span>
        <span>
          ${cost.toFixed(2)} / ${budget.toFixed(0)}
        </span>
      </div>
    </div>
  );
}
