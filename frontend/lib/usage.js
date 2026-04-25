// Usage limits & rolling-window aggregation.
//
// Mirrors the layout of Claude's own "Plan usage limits" page: a current
// session window and weekly windows split by model. Anthropic's exact
// limits are server-side and per-account, so we approximate by computing
// cost burned in rolling time windows against a configurable USD budget.
//
// Defaults below are tuned for the Max 5x plan; they're intentionally
// conservative so the bars feel meaningful. Override via env or the
// localStorage keys below — no code changes required.

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

// Plan presets. Anthropic's exact server-side limits are proprietary, so
// these are back-solved approximations: pick the right one and your bars
// will land within a few percentage points of the Claude settings page.
// "Custom" preserves whatever the user has tuned manually.
//
// Max 5x calibrated against real user data (Apr 2026):
//   session:     61% Claude vs $35.50 AgentDash → budget ≈ $58.20
//   weeklyAll:    9% Claude vs $35.50 AgentDash → budget ≈ $394.44
//   weeklySonnet: 2% Claude with very low Sonnet usage → budget ≈ $150
// Pro and Max 20x are scaled proportionally (1/5x and 4x respectively).
export const PLAN_PRESETS = {
  pro:    { label: 'Pro ($20/mo)',         session: 12,  weeklyAll: 80,   weeklySonnet: 30  },
  max5x:  { label: 'Max 5x ($100/mo)',     session: 58,  weeklyAll: 394,  weeklySonnet: 150 },
  max20x: { label: 'Max 20x ($200/mo)',    session: 232, weeklyAll: 1576, weeklySonnet: 600 },
  custom: { label: 'Custom (manual tune)', session: null, weeklyAll: null, weeklySonnet: null },
};

export const DEFAULT_PLAN = 'max5x';
export const DEFAULT_BUDGETS = {
  session:      PLAN_PRESETS[DEFAULT_PLAN].session,
  weeklyAll:    PLAN_PRESETS[DEFAULT_PLAN].weeklyAll,
  weeklySonnet: PLAN_PRESETS[DEFAULT_PLAN].weeklySonnet,
};

const PLAN_KEY = 'agentdash:plan:v1';
export const loadPlan = () => {
  if (typeof window === 'undefined') return DEFAULT_PLAN;
  try { return window.localStorage.getItem(PLAN_KEY) || DEFAULT_PLAN; }
  catch { return DEFAULT_PLAN; }
};
export const savePlan = (plan) => {
  try { window.localStorage.setItem(PLAN_KEY, plan); } catch { /* noop */ }
};

const STORAGE_KEY = 'agentdash:limits:v1';

export const loadBudgets = () => {
  if (typeof window === 'undefined') return DEFAULT_BUDGETS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_BUDGETS;
    return { ...DEFAULT_BUDGETS, ...JSON.parse(raw) };
  } catch { return DEFAULT_BUDGETS; }
};

export const saveBudgets = (budgets) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(budgets)); }
  catch { /* noop */ }
};

// One window definition. windowMs = how far back to look; matcher = optional
// per-event filter (used by Sonnet-only).
const WINDOWS = (budgets) => ({
  session: {
    label:    'Current session',
    windowMs: 5 * HOUR,
    budget:   budgets.session,
  },
  weeklyAll: {
    label:    'Weekly · all models',
    windowMs: 7 * DAY,
    budget:   budgets.weeklyAll,
  },
  weeklySonnet: {
    label:    'Weekly · Sonnet only',
    windowMs: 7 * DAY,
    budget:   budgets.weeklySonnet,
    matcher:  (ev) => /sonnet/i.test(ev.model || ''),
  },
});

// Aggregate `tokens` events into a usage report per window.
//   cost          — total USD burned in the window (matching the matcher)
//   percent       — cost / budget * 100 (clamped 0..999 for display sanity)
//   resetsInMs    — when the oldest in-window event drops out (a rolling
//                   approximation of Anthropic's "Resets at" timestamp)
//   resetsAtMs    — Date.now() + resetsInMs
export const computeUsage = (events, budgets = DEFAULT_BUDGETS) => {
  const now = Date.now();
  const windows = WINDOWS(budgets);
  const result = {};

  for (const [key, w] of Object.entries(windows)) {
    const cutoff = now - w.windowMs;
    let cost = 0;
    let oldestMs = now;
    let count = 0;

    for (const ev of events) {
      if (ev.type !== 'tokens') continue;
      if (w.matcher && !w.matcher(ev)) continue;
      const t = new Date(ev.timestamp).getTime();
      if (Number.isNaN(t) || t < cutoff) continue;
      cost += ev.costUsd || 0;
      if (t < oldestMs) oldestMs = t;
      count += 1;
    }

    const percent = w.budget > 0 ? Math.min(999, (cost / w.budget) * 100) : 0;
    const resetsInMs = count > 0 ? Math.max(0, oldestMs + w.windowMs - now) : w.windowMs;

    result[key] = {
      label:      w.label,
      cost,
      budget:     w.budget,
      percent,
      resetsInMs,
      resetsAtMs: now + resetsInMs,
      count,
    };
  }

  return result;
};

// Convert the /usage API payload into the same shape UsageBar expects.
// The cost numbers come from disk (account-wide); the budgets come from
// localStorage (user-tuned). We compute the percent client-side so changing
// the budget retunes the bar instantly without another API call.
export const usageFromApi = (apiPayload, budgets) => {
  if (!apiPayload) return null;
  const reportFor = (key, label, budget) => {
    const r = apiPayload[key] || { cost: 0, resetsInMs: 0, count: 0 };
    return {
      label,
      cost:       r.cost,
      budget,
      percent:    budget > 0 ? Math.min(999, (r.cost / budget) * 100) : 0,
      resetsInMs: r.resetsInMs,
      resetsAtMs: Date.now() + (r.resetsInMs || 0),
      count:      r.count,
    };
  };
  return {
    session:      reportFor('session',      'Current session',     budgets.session),
    weeklyAll:    reportFor('weeklyAll',    'Weekly · all models', budgets.weeklyAll),
    weeklySonnet: reportFor('weeklySonnet', 'Weekly · Sonnet only', budgets.weeklySonnet),
  };
};

// "3h 12m" / "2 days" / "now"
export const formatRemaining = (ms) => {
  if (ms <= 0) return 'now';
  const totalMin = Math.round(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

// Color band for a usage percentage — mirrors the green→amber→red feel
// of Claude's own bars.
export const usageColorClass = (percent) => {
  if (percent >= 90) return 'text-red-400';
  if (percent >= 70) return 'text-amber-300';
  if (percent >= 40) return 'text-emerald-300';
  return 'text-zinc-200';
};

export const usageBarColor = (percent) => {
  if (percent >= 90) return 'bg-red-500';
  if (percent >= 70) return 'bg-amber-400';
  return 'bg-emerald-400';
};
