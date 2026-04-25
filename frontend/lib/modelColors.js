// Model tier colors.
//
// Distinct subtle colors per tier so the Scrum Master can spot at a glance
// which agents are burning expensive Opus calls vs cheap Haiku ones, without
// reading the full model string.
//
//   Haiku  → teal       (cheap)
//   Sonnet → blue       (mid)
//   Opus   → violet     (premium)

export const modelTier = (model) => {
  if (!model) return 'unknown';
  if (/haiku/i.test(model)) return 'haiku';
  if (/sonnet/i.test(model)) return 'sonnet';
  if (/opus/i.test(model)) return 'opus';
  if (/gpt/i.test(model)) return 'gpt';
  return 'unknown';
};

const STYLES = {
  haiku:   { fg: 'text-teal-300',   bg: 'bg-teal-500/10',   border: 'border-teal-500/30',   dot: 'bg-teal-400'   },
  sonnet:  { fg: 'text-sky-300',    bg: 'bg-sky-500/10',    border: 'border-sky-500/30',    dot: 'bg-sky-400'    },
  opus:    { fg: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-500/30', dot: 'bg-violet-400' },
  gpt:     { fg: 'text-emerald-300',bg: 'bg-emerald-500/10',border: 'border-emerald-500/30',dot: 'bg-emerald-400'},
  unknown: { fg: 'text-zinc-400',   bg: 'bg-zinc-500/10',   border: 'border-zinc-500/30',   dot: 'bg-zinc-400'   },
};

export const modelTierStyle = (model) => STYLES[modelTier(model)];

// Compact label for the badge ("haiku 4.5", "opus 4.7", "gpt-4o", …).
export const modelLabel = (model) => {
  if (!model) return '—';
  const m = model.match(/(opus|sonnet|haiku)[-_]?([0-9]+[-._][0-9]+)?/i);
  if (m) {
    const tier = m[1].toLowerCase();
    const ver = m[2] ? m[2].replace(/[-_]/, '.') : '';
    return ver ? `${tier} ${ver}` : tier;
  }
  return model;
};
