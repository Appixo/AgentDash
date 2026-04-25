// Stable color assignment per agent name.
//
// Hashes the name into a fixed palette so the same agent always gets the
// same hue across charts and the event feed.

const PALETTE = [
  '#60a5fa', // blue
  '#34d399', // emerald
  '#f472b6', // pink
  '#fbbf24', // amber
  '#a78bfa', // violet
  '#22d3ee', // cyan
  '#fb7185', // rose
  '#4ade80', // green
];

const cache = new Map();

const hash = (str) => {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

export const colorForAgent = (name) => {
  if (!name) return '#94a3b8';
  if (cache.has(name)) return cache.get(name);
  const c = PALETTE[hash(name) % PALETTE.length];
  cache.set(name, c);
  return c;
};
