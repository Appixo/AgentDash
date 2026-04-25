'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { computeUsage, loadBudgets, usageFromApi } from '@/lib/usage';
import Sidebar from './Sidebar';
import MetricsRow from './MetricsRow';
import TeamRoster from './TeamRoster';
import TerminalFeed from './TerminalFeed';
import UsageBar from './UsageBar';
import BudgetEditor from './BudgetEditor';

const MAX_EVENTS = 2000;
const PROJECTS_POLL_MS = 30_000;
const USAGE_POLL_MS = 30_000;
const SELECTED_KEY = 'agentdash:selectedProjectId:v1';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';

const loadSelected = () => {
  if (typeof window === 'undefined') return Sidebar.ALL;
  try { return window.localStorage.getItem(SELECTED_KEY) || Sidebar.ALL; }
  catch { return Sidebar.ALL; }
};
const saveSelected = (id) => {
  try { window.localStorage.setItem(SELECTED_KEY, id); } catch { /* noop */ }
};

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(Sidebar.ALL);
  const [knownProjects, setKnownProjects] = useState([]);
  const [configuredAgents, setConfiguredAgents] = useState([]);
  const [budgets, setBudgets] = useState(loadBudgets);
  const [usageApi, setUsageApi] = useState(null);  // disk-wide tally from /usage
  // Tick once a minute so the "resets in" countdowns stay live even when
  // no new events are arriving.
  const [, setTick] = useState(0);

  useEffect(() => { setSelectedProjectId(loadSelected()); }, []);
  useEffect(() => { saveSelected(selectedProjectId); }, [selectedProjectId]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onReplay = (buffer) => {
      // Replay is the authoritative initial state — wipe local buffer first.
      setEvents(Array.isArray(buffer) ? buffer.slice(-MAX_EVENTS) : []);
    };
    const onEvent = (event) => {
      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('agent:replay', onReplay);
    socket.on('agent:event', onEvent);
    if (socket.connected) setConnected(true);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('agent:replay', onReplay);
      socket.off('agent:event', onEvent);
    };
  }, []);

  // Whenever the selected project changes, ask the server for a fresh
  // replay scoped to that project (so its full ~1000-event history loads
  // from SQLite even if AgentDash wasn't tailing that session at the time).
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !socket.connected) return;
    socket.emit('agent:requestReplay', selectedProjectId);
  }, [selectedProjectId, connected]);

  useEffect(() => {
    let cancelled = false;
    const fetchProjects = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/projects`);
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && Array.isArray(data.projects)) {
          setKnownProjects(data.projects);
        }
      } catch { /* network blip */ }
    };
    fetchProjects();
    const id = setInterval(fetchProjects, PROJECTS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Account-wide usage tally (disk-scan, all sessions). Polled separately
  // from the live event stream so the bars match Claude's settings page
  // even if AgentDash hasn't tailed every session.
  useEffect(() => {
    let cancelled = false;
    const fetchUsage = async () => {
      try {
        const r = await fetch(`${BACKEND_URL}/usage`);
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setUsageApi(data);
      } catch { /* network blip */ }
    };
    fetchUsage();
    const id = setInterval(fetchUsage, USAGE_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const { liveProjects, eventCounts } = useMemo(() => {
    const seen = new Map();
    const counts = {};
    for (const ev of events) {
      if (!ev.projectId) continue;
      counts[ev.projectId] = (counts[ev.projectId] || 0) + 1;
      if (!seen.has(ev.projectId)) {
        seen.set(ev.projectId, {
          projectId: ev.projectId,
          projectName: ev.projectName,
          projectPath: ev.projectPath,
        });
      }
    }
    return { liveProjects: Array.from(seen.values()), eventCounts: counts };
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (selectedProjectId === Sidebar.ALL) return events;
    return events.filter((ev) => ev.projectId === selectedProjectId);
  }, [events, selectedProjectId]);

  // Plan-level usage prefers the disk-wide /usage tally (matches Anthropic's
  // settings page); falls back to the in-memory event buffer until the
  // first /usage response lands.
  const planUsage = useMemo(() => {
    return usageApi ? usageFromApi(usageApi, budgets) : computeUsage(events, budgets);
  }, [usageApi, events, budgets]);
  const projectUsage = useMemo(() => computeUsage(filteredEvents, budgets), [filteredEvents, budgets]);

  const projectStats = useMemo(() => {
    let tokens = 0, errors = 0, actions = 0;
    const agents = new Set();
    for (const ev of filteredEvents) {
      if (ev.agentName) agents.add(ev.agentName);
      if (ev.type === 'tool_call') actions += 1;
      if (ev.type === 'error') errors += 1;
      if (ev.type === 'tokens') tokens += ev.tokens?.total || 0;
    }
    return { tokens, errors, actions, agentCount: agents.size };
  }, [filteredEvents]);

  const activeProject = useMemo(() => {
    if (selectedProjectId === Sidebar.ALL) return null;
    return liveProjects.find((p) => p.projectId === selectedProjectId)
        || knownProjects.find((p) => p.projectId === selectedProjectId)
        || null;
  }, [selectedProjectId, liveProjects, knownProjects]);

  // Fetch the configured agent roster (from `.claude/agents/`) whenever
  // the selected project changes. Empty list while in "All projects" view.
  useEffect(() => {
    if (!activeProject?.projectPath) {
      setConfiguredAgents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = `${BACKEND_URL}/agents?projectPath=${encodeURIComponent(activeProject.projectPath)}`;
        const r = await fetch(url);
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setConfiguredAgents(Array.isArray(data.agents) ? data.agents : []);
      } catch { /* network blip */ }
    })();
    return () => { cancelled = true; };
  }, [activeProject?.projectPath]);

  const isSingleProject = selectedProjectId !== Sidebar.ALL;
  const headerTitle = activeProject?.projectName || (isSingleProject ? selectedProjectId : 'All projects');
  const headerSub = activeProject?.projectPath
    || `${liveProjects.length} live · ${knownProjects.length} known`;

  return (
    <div className="h-screen w-screen flex overflow-hidden">
      <Sidebar
        liveProjects={liveProjects}
        knownProjects={knownProjects}
        selectedProjectId={selectedProjectId}
        onSelect={setSelectedProjectId}
        eventCounts={eventCounts}
      />

      <main className="flex-1 min-w-0 flex flex-col relative">
        {/* ---- Plan usage limits (mirrors Anthropic's settings panel) ---- */}
        <section className="border-b border-white/10 px-6 py-3 flex items-center gap-8">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold tracking-tight truncate">{headerTitle}</h1>
              {isSingleProject && (
                <span className="text-[10px] uppercase tracking-wider text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-0.5">
                  scrum master view
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 truncate">
              {headerSub}
              {usageApi && (
                <span className="ml-2 text-zinc-600">
                  · {usageApi.scannedFiles} session file(s) scanned
                </span>
              )}
            </p>
          </div>

          <div className="flex-1 flex items-start justify-end gap-8 flex-wrap">
            <UsageBar usage={planUsage.session} prominent />
            <UsageBar usage={planUsage.weeklyAll} />
            <UsageBar usage={planUsage.weeklySonnet} />
          </div>

          <div className="flex flex-col items-end gap-2 pl-4 border-l border-white/10 shrink-0">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  connected ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              <span className="text-zinc-300">
                {connected ? 'connected' : 'disconnected'}
              </span>
            </div>
            <BudgetEditor budgets={budgets} onChange={setBudgets} />
          </div>
        </section>

        {/* ---- Per-project KPI strip ---- */}
        {isSingleProject && (
          <section className="px-6 py-2 border-b border-white/10 flex items-center gap-6 text-xs text-zinc-400">
            <KPI label="Session share" value={`${projectUsage.session.percent.toFixed(1)}%`}
                 hint={`This project's share of the rolling 5h session window`} />
            <KPI label="Weekly share" value={`${projectUsage.weeklyAll.percent.toFixed(1)}%`} />
            <KPI label="Tokens" value={projectStats.tokens.toLocaleString()} />
            <KPI label="Actions" value={projectStats.actions.toLocaleString()} />
            <KPI label="Errors" value={projectStats.errors.toLocaleString()} accent={projectStats.errors > 0 ? 'red' : 'default'} />
            <KPI label="Agents" value={projectStats.agentCount} />
          </section>
        )}

        {isSingleProject && (
          <TeamRoster
            events={filteredEvents}
            projectName={activeProject?.projectName}
            configuredAgents={configuredAgents}
            sessionBudget={budgets.session}
          />
        )}

        <MetricsRow events={filteredEvents} sessionBudget={budgets.session} />

        <TerminalFeed events={filteredEvents} showProject={selectedProjectId === Sidebar.ALL} />
      </main>
    </div>
  );
}

function KPI({ label, value, accent = 'default', hint }) {
  const valueColor = accent === 'red' ? 'text-red-400' : 'text-zinc-100';
  return (
    <div className="flex items-baseline gap-1.5" title={hint}>
      <span className={`tabular-nums font-semibold ${valueColor}`}>{value}</span>
      <span className="text-zinc-500">{label}</span>
    </div>
  );
}
