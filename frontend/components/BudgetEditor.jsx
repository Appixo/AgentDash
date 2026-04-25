'use client';

import { useState } from 'react';
import { saveBudgets, savePlan, loadPlan, PLAN_PRESETS } from '@/lib/usage';

// Inline popover for tuning the three USD budgets. AgentDash can't read
// the user's Anthropic plan from local files (it lives server-side, not
// in ~/.claude), so we offer plan presets the user picks once. They can
// further fine-tune the dollar fields manually if their numbers don't
// quite match Claude's settings page.
export default function BudgetEditor({ budgets, onChange }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState(() => loadPlan());
  const [draft, setDraft] = useState(budgets);

  const applyPreset = (newPlan) => {
    setPlan(newPlan);
    const preset = PLAN_PRESETS[newPlan];
    if (preset && preset.session != null) {
      // Custom keeps whatever the user has typed; presets overwrite.
      setDraft({
        session:      preset.session,
        weeklyAll:    preset.weeklyAll,
        weeklySonnet: preset.weeklySonnet,
      });
    }
  };

  const apply = () => {
    const cleaned = {
      session:      Number(draft.session) || 1,
      weeklyAll:    Number(draft.weeklyAll) || 1,
      weeklySonnet: Number(draft.weeklySonnet) || 1,
    };
    saveBudgets(cleaned);
    savePlan(plan);
    onChange(cleaned);
    setOpen(false);
  };

  const cancel = () => {
    setDraft(budgets);
    setPlan(loadPlan());
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => { setDraft(budgets); setPlan(loadPlan()); setOpen(true); }}
        className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 underline-offset-2 hover:underline"
        title="Pick your Anthropic plan or fine-tune the USD budgets"
      >
        plan: {PLAN_PRESETS[plan]?.label.split(' ')[0] || 'tune'}
      </button>
    );
  }

  return (
    <div className="absolute right-6 top-16 z-20 bg-[#0e1116] border border-white/15 rounded-md shadow-xl p-4 w-80 space-y-3">
      <div>
        <h4 className="text-xs uppercase tracking-wider text-zinc-300 mb-1">Plan & budgets</h4>
        <p className="text-[10px] text-zinc-500 leading-snug">
          AgentDash can't auto-detect your Anthropic plan (it lives server-side, not in <code>~/.claude</code>). Pick a preset, then fine-tune so the percentages match Claude's settings page.
        </p>
      </div>

      <label className="block">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">Anthropic plan</span>
        <select
          value={plan}
          onChange={(e) => applyPreset(e.target.value)}
          className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-emerald-500/40"
        >
          {Object.entries(PLAN_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
      </label>

      <div className="border-t border-white/10 pt-3 space-y-2">
        <Field label="Session ($, 5h rolling)" value={draft.session}
               onChange={(v) => { setDraft({ ...draft, session: v }); setPlan('custom'); }} />
        <Field label="Weekly · all models ($)" value={draft.weeklyAll}
               onChange={(v) => { setDraft({ ...draft, weeklyAll: v }); setPlan('custom'); }} />
        <Field label="Weekly · Sonnet only ($)" value={draft.weeklySonnet}
               onChange={(v) => { setDraft({ ...draft, weeklySonnet: v }); setPlan('custom'); }} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={cancel}
          className="text-[11px] px-3 py-1 rounded text-zinc-400 hover:text-zinc-200"
        >
          Cancel
        </button>
        <button
          onClick={apply}
          className="text-[11px] px-3 py-1 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/30"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        type="number"
        min="1"
        step="1"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-sm text-zinc-100 tabular-nums focus:outline-none focus:border-emerald-500/40"
      />
    </label>
  );
}
