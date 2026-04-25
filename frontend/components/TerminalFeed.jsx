'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import EventRow from './EventRow';
import { colorForAgent } from '@/lib/agentColors';

const TYPE_PILLS = [
  { id: 'thought',     label: 'thought' },
  { id: 'tool_call',   label: 'tool' },
  { id: 'tool_result', label: 'result' },
  { id: 'tokens',      label: 'tokens' },
  { id: 'error',       label: 'error' },
];

export default function TerminalFeed({ events, showProject }) {
  const [query, setQuery] = useState('');
  const [activeTypes, setActiveTypes] = useState(new Set());
  const [activeAgents, setActiveAgents] = useState(new Set());
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const stickyRef = useRef(true);

  // Hotkeys
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      const typing = t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Toggle helpers — use plain Set semantics so a click adds/removes one filter.
  const toggleType = (id) => setActiveTypes((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAgent = (name) => setActiveAgents((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const clearAll = () => { setQuery(''); setActiveTypes(new Set()); setActiveAgents(new Set()); };

  // Agents that have actually emitted events — drives the dynamic agent
  // pill row. Sorted by frequency so the busiest are leftmost.
  const agentList = useMemo(() => {
    const counts = new Map();
    for (const ev of events) {
      if (!ev.agentName) continue;
      counts.set(ev.agentName, (counts.get(ev.agentName) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [events]);

  // Combined filter: search ⋂ types ⋂ agents
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((ev) => {
      if (activeTypes.size > 0 && !activeTypes.has(ev.type)) return false;
      if (activeAgents.size > 0 && !activeAgents.has(ev.agentName || '')) return false;
      if (!q) return true;
      const hay = [ev.message, ev.agentName, ev.agentRole, ev.type, ev.model, ev.projectName]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [events, query, activeTypes, activeAgents]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distanceFromBottom < 60;
  };
  useEffect(() => {
    const el = listRef.current;
    if (el && stickyRef.current) el.scrollTop = el.scrollHeight;
  }, [filtered]);

  const hasFilters = query || activeTypes.size > 0 || activeAgents.size > 0;

  return (
    <section className="flex-1 min-h-0 flex flex-col border-t border-white/10 bg-black/30">
      <header className="px-4 py-2 border-b border-white/10 sticky top-0 z-10 bg-black/70 backdrop-blur-sm space-y-2">
        <div className="flex items-center gap-3">
          <h3 className="text-xs uppercase tracking-wider text-zinc-400 shrink-0">
            Terminal stream
          </h3>

          <div className="flex-1 relative">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
              placeholder="Search messages, agents, types, models…   ( /  or  Ctrl+F )"
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-1 pr-16 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
            />
            {hasFilters && (
              <button
                onClick={clearAll}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500 hover:text-zinc-300 px-1"
                title="Clear all filters (Esc)"
              >
                clear
              </button>
            )}
          </div>

          <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">
            {hasFilters
              ? `${filtered.length} / ${events.length}`
              : `${events.length} event${events.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {/* Type pills — click to narrow the stream by event kind */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] uppercase tracking-wider text-zinc-600 mr-1">type:</span>
          {TYPE_PILLS.map((p) => (
            <Pill
              key={p.id}
              active={activeTypes.has(p.id)}
              onClick={() => toggleType(p.id)}
              variant={p.id === 'error' ? 'red' : 'default'}
            >
              {p.label}
            </Pill>
          ))}
        </div>

        {/* Agent pills — only show if there's >1 agent active in the stream */}
        {agentList.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider text-zinc-600 mr-1">agent:</span>
            {agentList.slice(0, 12).map(({ name, count }) => (
              <AgentPill
                key={name}
                name={name}
                count={count}
                active={activeAgents.has(name)}
                onClick={() => toggleAgent(name)}
              />
            ))}
            {agentList.length > 12 && (
              <span className="text-[10px] text-zinc-600">+{agentList.length - 12} more</span>
            )}
          </div>
        )}
      </header>

      <ul
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto"
        aria-live="polite"
      >
        {filtered.length === 0 ? (
          <li className="px-6 py-10 text-center text-zinc-500 text-sm">
            {hasFilters ? 'No events match the current filters.' : 'Waiting for agent events…'}
          </li>
        ) : (
          filtered.map((ev) => (
            <EventRow
              key={ev.id || ev.timestamp + ev.message}
              event={ev}
              showProject={showProject}
              query={query}
            />
          ))
        )}
      </ul>
    </section>
  );
}

function Pill({ active, onClick, children, variant = 'default' }) {
  const base = 'text-[10px] px-2 py-0.5 rounded-full border transition cursor-pointer select-none';
  const styles = active
    ? variant === 'red'
      ? 'bg-red-500/20 border-red-500/50 text-red-200'
      : 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200'
    : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:bg-white/[0.07]';
  return (
    <button onClick={onClick} className={`${base} ${styles}`}>{children}</button>
  );
}

function AgentPill({ name, count, active, onClick }) {
  const color = colorForAgent(name);
  return (
    <button
      onClick={onClick}
      className="text-[10px] px-2 py-0.5 rounded-full border transition cursor-pointer select-none flex items-center gap-1.5"
      style={{
        backgroundColor: active ? `${color}33` : `${color}10`,
        borderColor: active ? `${color}99` : `${color}33`,
        color: active ? color : '#a1a1aa',
      }}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {name}
      <span className="opacity-60 tabular-nums">{count}</span>
    </button>
  );
}
