'use client';

import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { colorForAgent } from '@/lib/agentColors';

// At this density these are indicators, not dashboards: trend shape +
// spikes are what matters. Totals live in the card titles so you don't
// have to count bars or hover to read them.

const BUCKET_MS = 10_000;

const bucketKey = (iso) => {
  const t = new Date(iso).getTime();
  return Math.floor(t / BUCKET_MS) * BUCKET_MS;
};

const formatTime = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour12: false, minute: '2-digit', second: '2-digit' });

const fmtPct = (n) => `${(n || 0).toFixed(2)}%`;

export default function MetricsRow({ events, sessionBudget = 10 }) {
  const { tokenSeries, burnSeries, errorSeries, agentNames, totals } = useMemo(() => {
    const tokens = new Map();
    const burn = new Map();
    const errs = new Map();
    const agents = new Set();
    let totalTokens = 0, totalBurnPct = 0, totalErrors = 0;

    for (const ev of events) {
      const k = bucketKey(ev.timestamp);
      if (ev.type === 'tokens' && ev.tokens) {
        const total = ev.tokens.total || 0;
        const agent = ev.agentName || 'unknown';
        agents.add(agent);
        const row = tokens.get(k) || { time: k };
        row[agent] = (row[agent] || 0) + total;
        tokens.set(k, row);

        const pct = sessionBudget > 0 ? ((ev.costUsd || 0) / sessionBudget) * 100 : 0;
        const brow = burn.get(k) || { time: k, percent: 0 };
        brow.percent += pct;
        burn.set(k, brow);

        totalTokens += total;
        totalBurnPct += pct;
      }
      if (ev.type === 'error') {
        const row = errs.get(k) || { time: k, errors: 0 };
        row.errors += 1;
        errs.set(k, row);
        totalErrors += 1;
      }
    }

    return {
      tokenSeries: Array.from(tokens.values()).sort((a, b) => a.time - b.time),
      burnSeries:  Array.from(burn.values()).sort((a, b) => a.time - b.time),
      errorSeries: Array.from(errs.values()).sort((a, b) => a.time - b.time),
      agentNames:  Array.from(agents),
      totals: { tokens: totalTokens, burnPct: totalBurnPct, errors: totalErrors },
    };
  }, [events, sessionBudget]);

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-2 px-4 py-2 border-b border-white/10">
      <Card title="Tokens / 10s" suffix={`${totals.tokens.toLocaleString()} total`}>
        <ResponsiveContainer width="100%" height={80}>
          <AreaChart data={tokenSeries} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid stroke="#ffffff08" vertical={false} />
            <XAxis dataKey="time" tickFormatter={formatTime} stroke="#52525b" fontSize={9} tickLine={false} />
            <YAxis stroke="#52525b" fontSize={9} tickLine={false} width={28} />
            <Tooltip
              contentStyle={{ background: '#0b0d10', border: '1px solid #ffffff20', fontSize: 11 }}
              labelFormatter={formatTime}
            />
            {agentNames.map((name) => (
              <Area
                key={name}
                type="monotone"
                dataKey={name}
                stackId="1"
                stroke={colorForAgent(name)}
                fill={colorForAgent(name)}
                fillOpacity={0.35}
                strokeWidth={1}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card title="Session burn / 10s" suffix={`${fmtPct(totals.burnPct)} cumulative`}>
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={burnSeries} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid stroke="#ffffff08" vertical={false} />
            <XAxis dataKey="time" tickFormatter={formatTime} stroke="#52525b" fontSize={9} tickLine={false} />
            <YAxis stroke="#52525b" fontSize={9} tickLine={false} width={28} tickFormatter={(v) => `${v.toFixed(1)}%`} />
            <Tooltip
              contentStyle={{ background: '#0b0d10', border: '1px solid #ffffff20', fontSize: 11 }}
              labelFormatter={formatTime}
              formatter={(v) => fmtPct(v)}
            />
            <Line type="monotone" dataKey="percent" stroke="#fbbf24" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="Errors / 10s"
        suffix={`${totals.errors} total`}
        suffixAccent={totals.errors > 0 ? 'red' : 'default'}
      >
        <ResponsiveContainer width="100%" height={80}>
          <BarChart data={errorSeries} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
            <CartesianGrid stroke="#ffffff08" vertical={false} />
            <XAxis dataKey="time" tickFormatter={formatTime} stroke="#52525b" fontSize={9} tickLine={false} />
            <YAxis stroke="#52525b" fontSize={9} tickLine={false} width={28} allowDecimals={false} />
            <Tooltip
              contentStyle={{ background: '#0b0d10', border: '1px solid #ffffff20', fontSize: 11 }}
              labelFormatter={formatTime}
            />
            <Bar dataKey="errors" fill="#f87171" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </section>
  );
}

function Card({ title, suffix, suffixAccent = 'default', children }) {
  const accent = suffixAccent === 'red' ? 'text-red-400' : 'text-zinc-400';
  return (
    <div className="bg-white/[0.02] border border-white/10 rounded-md px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[10px] uppercase tracking-wider text-zinc-400">{title}</h3>
        {suffix && <span className={`text-[10px] tabular-nums ${accent}`}>{suffix}</span>}
      </div>
      {children}
    </div>
  );
}
