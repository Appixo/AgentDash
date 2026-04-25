'use client';

import { useMemo, useState } from 'react';
import { colorForAgent } from '@/lib/agentColors';
import { usageColorClass } from '@/lib/usage';
import { modelTierStyle, modelLabel } from '@/lib/modelColors';

const aggregate = (events, configuredAgents = []) => {
  const byAgent = new Map();

  for (const a of configuredAgents) {
    byAgent.set(a.name, {
      agentName: a.name,
      displayName: a.displayName || a.name,
      agentRole: a.role || 'agent',
      model: a.model || '—',
      description: a.description || '',
      scope: a.scope,
      configured: true,
      actions: 0, errors: 0, thoughts: 0, cost: 0, tokens: 0,
      lastSeen: null,
    });
  }

  for (const ev of events) {
    const key = ev.agentName || 'unknown';
    let row = byAgent.get(key);
    if (!row) {
      row = {
        agentName: key,
        displayName: key,
        agentRole: ev.agentRole || '—',
        model: ev.model || '—',
        description: '',
        scope: null,
        configured: false,
        actions: 0, errors: 0, thoughts: 0, cost: 0, tokens: 0,
        lastSeen: ev.timestamp,
      };
      byAgent.set(key, row);
    }
    if (ev.agentRole && row.agentRole === 'agent') row.agentRole = ev.agentRole;
    if (ev.model && row.model === '—') row.model = ev.model;
    if (!row.lastSeen || ev.timestamp > row.lastSeen) row.lastSeen = ev.timestamp;

    if (ev.type === 'tool_call')   row.actions  += 1;
    if (ev.type === 'error')       row.errors   += 1;
    if (ev.type === 'thought')     row.thoughts += 1;
    if (ev.type === 'tokens') {
      row.cost   += ev.costUsd || 0;
      row.tokens += ev.tokens?.total || 0;
    }
  }

  const rows = Array.from(byAgent.values());
  const active = rows
    .filter((r) => r.actions + r.errors + r.cost > 0)
    .sort((a, b) => {
      if (b.cost !== a.cost) return b.cost - a.cost;
      return b.actions - a.actions;
    });
  const idle = rows
    .filter((r) => r.actions + r.errors + r.cost === 0)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { active, idle };
};

const fmtPct = (n) => `${(n * 100).toFixed(1)}%`;
const fmtPctSession = (n) => `${n.toFixed(1)}%`;
const fmtNum = (n) => (n || 0).toLocaleString();

const errorRateClass = (rate) => {
  if (rate >= 0.3) return 'text-red-400';
  if (rate >= 0.1) return 'text-amber-400';
  return 'text-zinc-300';
};

export default function TeamRoster({ events, projectName, configuredAgents = [], sessionBudget = 10 }) {
  const { active, idle } = useMemo(
    () => aggregate(events, configuredAgents),
    [events, configuredAgents],
  );
  const [idleOpen, setIdleOpen] = useState(false);

  if (active.length === 0 && idle.length === 0) {
    return (
      <section className="px-4 py-6 border-b border-white/10 text-center text-sm text-zinc-500">
        No agents configured for this project, and no live activity yet.
      </section>
    );
  }

  return (
    <section className="px-4 py-3 border-b border-white/10">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase tracking-wider text-zinc-400">
          Team roster {projectName ? <span className="text-zinc-600">· {projectName}</span> : null}
        </h3>
        <span className="text-[10px] text-zinc-500">
          {active.length} active · {idle.length} idle
        </span>
      </div>

      <div className="overflow-x-auto bg-white/[0.02] border border-white/10 rounded-md">
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
            <tr>
              <Th className="text-left">Agent</Th>
              <Th className="text-left">Role</Th>
              <Th className="text-left">Model</Th>
              <Th className="text-right">Actions</Th>
              <Th className="text-right">Errors</Th>
              <Th className="text-right">Error rate</Th>
              <Th className="text-right">Tokens</Th>
              <Th className="text-right" title={`As share of session budget ($${sessionBudget})`}>
                Session %
              </Th>
            </tr>
          </thead>

          {/* ---- Active agents ---- */}
          <tbody>
            {active.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-xs text-zinc-600">
                  No active agents in this project right now.
                </td>
              </tr>
            )}
            {active.map((r) => (
              <RosterRow key={r.agentName} row={r} sessionBudget={sessionBudget} dim={false} />
            ))}
          </tbody>

          {/* ---- Idle divider + collapsed group ---- */}
          {idle.length > 0 && (
            <>
              <tbody>
                <tr className="border-t-2 border-white/10">
                  <td colSpan={8}>
                    <button
                      onClick={() => setIdleOpen((o) => !o)}
                      className="w-full px-3 py-1.5 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02] transition"
                    >
                      <span className="inline-block w-3 text-center">{idleOpen ? '▾' : '▸'}</span>
                      Idle agents
                      <span className="text-zinc-600">({idle.length})</span>
                      <span className="ml-auto text-zinc-600 normal-case">
                        {idleOpen ? 'click to hide' : 'click to expand'}
                      </span>
                    </button>
                  </td>
                </tr>
              </tbody>
              {idleOpen && (
                <tbody>
                  {idle.map((r) => (
                    <RosterRow key={r.agentName} row={r} sessionBudget={sessionBudget} dim />
                  ))}
                </tbody>
              )}
            </>
          )}
        </table>
      </div>
    </section>
  );
}

function RosterRow({ row, sessionBudget, dim }) {
  const total = row.actions + row.errors;
  const rate = total === 0 ? 0 : row.errors / total;
  const sessionPct = sessionBudget > 0 ? (row.cost / sessionBudget) * 100 : 0;
  const overBudget = sessionPct >= 100;
  const color = colorForAgent(row.agentName);
  const tier = modelTierStyle(row.model);

  return (
    <tr
      className={`border-b border-white/5 last:border-0 hover:bg-white/[0.02] ${dim ? 'opacity-50' : ''}`}
      title={row.description || undefined}
    >
      <Td>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-zinc-100">{row.displayName}</span>
          {row.configured && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-white/10 text-zinc-500"
              title={row.scope === 'project' ? 'defined in .claude/agents/' : 'user-global agent'}
            >
              {row.scope === 'project' ? 'project' : 'user'}
            </span>
          )}
          {dim && (
            <span className="text-[9px] uppercase tracking-wider text-zinc-600">idle</span>
          )}
        </span>
      </Td>
      <Td className="text-zinc-400">{row.agentRole}</Td>
      <Td>
        {row.model && row.model !== '—' ? (
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${tier.fg} ${tier.bg} ${tier.border} font-mono`}>
            {modelLabel(row.model)}
          </span>
        ) : <span className="text-zinc-600">—</span>}
      </Td>
      <Td className="text-right tabular-nums text-zinc-100">{fmtNum(row.actions)}</Td>
      <Td className={`text-right tabular-nums ${row.errors > 0 ? 'text-red-300' : 'text-zinc-500'}`}>
        {fmtNum(row.errors)}
      </Td>
      <Td className={`text-right tabular-nums ${errorRateClass(rate)}`}>
        {total === 0 ? '—' : fmtPct(rate)}
      </Td>
      <Td className="text-right tabular-nums text-zinc-300">{fmtNum(row.tokens)}</Td>
      <Td className="text-right" title={`$${row.cost.toFixed(4)}`}>
        <div className="flex items-center justify-end gap-2">
          {overBudget && (
            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300">
              over
            </span>
          )}
          <span className={`tabular-nums ${usageColorClass(sessionPct)}`}>
            {fmtPctSession(sessionPct)}
          </span>
        </div>
      </Td>
    </tr>
  );
}

function Th({ children, className = '', title }) {
  return <th className={`px-3 py-2 font-medium ${className}`} title={title}>{children}</th>;
}
function Td({ children, className = '', title }) {
  return <td className={`px-3 py-2 ${className}`} title={title}>{children}</td>;
}
