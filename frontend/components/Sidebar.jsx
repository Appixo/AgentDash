'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

const ALL = '__all__';
const ORDER_STORAGE_KEY = 'agentdash:sidebarOrder:v1';
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // "active" = activity in last 5 min

// Persist user-customised drag order across reloads.
const loadOrder = () => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ORDER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
};
const saveOrder = (order) => {
  try { window.localStorage.setItem(ORDER_STORAGE_KEY, JSON.stringify(order)); }
  catch { /* quota / private mode */ }
};

// Apply the saved order to a project list. Unknown (new) projects keep their
// natural order at the end, so the sidebar never reshuffles unexpectedly.
const applyOrder = (projects, order) => {
  const indexOf = (id) => {
    const i = order.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...projects].sort((a, b) => indexOf(a.projectId) - indexOf(b.projectId));
};

export default function Sidebar({
  liveProjects,         // projects derived from the live event stream
  knownProjects,        // /projects discovery — every Claude project on disk
  selectedProjectId,
  onSelect,
  eventCounts,
}) {
  const [order, setOrder] = useState(() => loadOrder());
  const dragId = useRef(null);

  // Merge: liveProjects update names/paths, knownProjects fills in inactive
  // ones. liveProjects always win because they reflect what's happening NOW.
  const merged = useMemo(() => {
    const map = new Map();
    for (const p of knownProjects || []) {
      map.set(p.projectId, { ...p, isLive: false });
    }
    for (const p of liveProjects || []) {
      const prev = map.get(p.projectId) || {};
      map.set(p.projectId, {
        ...prev,
        ...p,
        isLive: true,
        lastActivityMs: Date.now(),
      });
    }
    return Array.from(map.values());
  }, [liveProjects, knownProjects]);

  const ordered = useMemo(() => applyOrder(merged, order), [merged, order]);

  const now = Date.now();
  const active = ordered.filter(
    (p) => p.isLive || (p.lastActivityMs && now - p.lastActivityMs < ACTIVE_THRESHOLD_MS),
  );
  const inactive = ordered.filter(
    (p) => !active.includes(p),
  );

  // ---- Drag-and-drop handlers ----
  const onDragStart = (e, id) => {
    dragId.current = id;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e, targetId, section) => {
    e.preventDefault();
    const sourceId = dragId.current;
    if (!sourceId || sourceId === targetId) return;

    // Reorder within whatever the user sees today; persist a global order
    // (active and inactive concatenated) so user intent survives section flips.
    const sectionList = section === 'active' ? active : inactive;
    const ids = sectionList.map((p) => p.projectId);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);

    const otherList = section === 'active' ? inactive : active;
    const fullOrder = section === 'active'
      ? [...ids, ...otherList.map((p) => p.projectId)]
      : [...otherList.map((p) => p.projectId), ...ids];

    setOrder(fullOrder);
    saveOrder(fullOrder);
    dragId.current = null;
  };

  return (
    <aside className="w-64 shrink-0 border-r border-white/10 bg-black/20 flex flex-col">
      <div className="px-4 py-4 border-b border-white/10">
        <h2 className="text-xs uppercase tracking-wider text-zinc-500">Workspaces</h2>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <ProjectButton
          active={selectedProjectId === ALL}
          onClick={() => onSelect(ALL)}
          name="All projects"
          subtitle={`${active.length} active · ${inactive.length} inactive`}
          count={Object.values(eventCounts).reduce((a, b) => a + b, 0)}
        />

        <SectionHeader label={`Active (${active.length})`} />
        {active.length === 0 ? (
          <Empty text="No live activity yet…" />
        ) : (
          active.map((p) => (
            <ProjectRow
              key={p.projectId}
              project={p}
              section="active"
              isSelected={selectedProjectId === p.projectId}
              onSelect={onSelect}
              count={eventCounts[p.projectId] || 0}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          ))
        )}

        <SectionHeader label={`Inactive (${inactive.length})`} />
        {inactive.length === 0 ? (
          <Empty text="No previous projects." />
        ) : (
          inactive.map((p) => (
            <ProjectRow
              key={p.projectId}
              project={p}
              section="inactive"
              isSelected={selectedProjectId === p.projectId}
              onSelect={onSelect}
              count={eventCounts[p.projectId] || 0}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              dimmed
            />
          ))
        )}
      </nav>

      <div className="px-4 py-3 border-t border-white/10 text-[10px] text-zinc-600">
        Drag projects to reorder · order saved locally
      </div>
    </aside>
  );
}

function SectionHeader({ label }) {
  return (
    <div className="px-3 mt-3 mb-1 text-[10px] uppercase tracking-wider text-zinc-600">
      {label}
    </div>
  );
}

function Empty({ text }) {
  return <div className="px-4 py-2 text-xs text-zinc-600">{text}</div>;
}

function ProjectRow({
  project, section, isSelected, onSelect, count,
  onDragStart, onDragOver, onDrop, dimmed = false,
}) {
  const subtitle = project.projectPath || '';
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, project.projectId)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, project.projectId, section)}
    >
      <ProjectButton
        active={isSelected}
        onClick={() => onSelect(project.projectId)}
        name={project.projectName || project.projectId}
        subtitle={subtitle}
        count={count}
        dimmed={dimmed}
        live={project.isLive}
      />
    </div>
  );
}

function ProjectButton({ active, onClick, name, subtitle, count, dimmed = false, live = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-2 flex items-start gap-2 hover:bg-white/[0.04] transition cursor-grab active:cursor-grabbing ${
        active ? 'bg-white/[0.06] border-l-2 border-emerald-400' : 'border-l-2 border-transparent'
      } ${dimmed ? 'opacity-60' : ''}`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-100 truncate flex items-center gap-1.5">
          {live && <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
          <span className="truncate">{name}</span>
        </div>
        {subtitle && (
          <div className="text-[10px] text-zinc-500 truncate">{subtitle}</div>
        )}
      </div>
      <span className="text-[10px] text-zinc-400 tabular-nums shrink-0 mt-0.5">
        {count > 0 ? count : ''}
      </span>
    </button>
  );
}

Sidebar.ALL = ALL;
