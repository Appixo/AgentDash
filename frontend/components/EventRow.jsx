'use client';

import { colorForAgent } from '@/lib/agentColors';
import { highlight } from '@/lib/highlight';
import { modelTierStyle, modelLabel } from '@/lib/modelColors';

const TYPE_STYLES = {
  thought:     { label: 'THOUGHT',  badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  tool_call:   { label: 'TOOL',     badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  tool_result: { label: 'RESULT',   badge: 'bg-teal-500/20 text-teal-300 border-teal-500/40' },
  error:       { label: 'ERROR',    badge: 'bg-red-500/20 text-red-300 border-red-500/40' },
  tokens:      { label: 'TOKENS',   badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  system:      { label: 'SYSTEM',   badge: 'bg-slate-500/20 text-slate-300 border-slate-500/40' },
  log:         { label: 'LOG',      badge: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/40' },
};

const formatTime = (iso) => {
  try { return new Date(iso).toLocaleTimeString(undefined, { hour12: false }); }
  catch { return ''; }
};

export default function EventRow({ event, showProject, query = '' }) {
  const style = TYPE_STYLES[event.type] || TYPE_STYLES.log;
  const agentColor = colorForAgent(event.agentName);
  const tierStyle = modelTierStyle(event.model);
  const isError = event.type === 'error';

  return (
    <li
      className={`flex gap-3 px-4 py-2 border-b border-white/5 hover:bg-white/[0.04] ${
        isError ? 'bg-red-500/[0.06] border-l-2 border-l-red-500/60' : ''
      }`}
    >
      <span className="text-xs text-zinc-500 shrink-0 tabular-nums w-20">
        {formatTime(event.timestamp)}
      </span>

      {showProject && event.projectName && (
        <span className="text-[10px] px-2 py-0.5 h-fit rounded border border-white/10 text-zinc-400 shrink-0">
          {event.projectName}
        </span>
      )}

      {event.agentName && (
        <span
          className="text-[10px] px-2 py-0.5 h-fit rounded shrink-0 font-medium"
          style={{
            color: agentColor,
            backgroundColor: `${agentColor}1f`,
            border: `1px solid ${agentColor}55`,
          }}
          title={event.model ? `${event.agentRole || 'agent'} · ${event.model}` : event.agentRole}
        >
          {highlight(event.agentName, query)}
        </span>
      )}

      <span
        className={`text-[10px] tracking-wider px-2 py-0.5 h-fit rounded border shrink-0 ${style.badge}`}
      >
        {highlight(style.label, query)}
      </span>

      <span className="text-sm text-zinc-200 break-words flex-1">
        {highlight(event.message, query)}
      </span>

      {event.model && (
        <span
          className={`text-[10px] px-1.5 py-0.5 h-fit rounded border shrink-0 hidden md:inline ${tierStyle.fg} ${tierStyle.bg} ${tierStyle.border}`}
          title={event.model}
        >
          {highlight(modelLabel(event.model), query)}
        </span>
      )}
    </li>
  );
}
