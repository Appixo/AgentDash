// Claude Code session tailer.
//
// Claude Code persists transcripts under:
//   ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl                      ← main thread
//   ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/agent-<id>.jsonl ← sub-agent
//
// Each line is a complete JSON event: assistant turns (text + tool_use),
// user turns (tool_result), permission-mode changes, etc. Every line carries
// the real cwd, model, slug, gitBranch, and (for assistant turns) actual
// token usage with cache breakdown.
//
// Sub-agent attribution: Claude Code spawns sub-agents via the `Agent` tool
// (older code paths used `Task`). The Agent tool's input contains the real
// agent identifier — `name` ("can") and `subagent_type` ("can-issue-triager")
// — but those fields appear in the PARENT session JSONL, not in the
// sub-agent file itself. We resolve attribution by:
//   1. Indexing every Agent tool call we see (across all parent sessions)
//      keyed by the first 200 chars of the spawning prompt.
//   2. When emitting events from a sub-agent file, scanning its first user
//      message for a matching prompt prefix and using the Agent call's
//      friendly name.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { findProjectRoot } from './projectRoot.js';

const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

const BACKFILL_RECENT_MS = 5 * 60 * 1000;
const BACKFILL_LINES = 25;
const PROMPT_FINGERPRINT_LEN = 200;

const PRICING = {
  'claude-opus-4-7':           { in: 0.015, out: 0.075, cacheRead: 0.0015,  cacheWrite: 0.01875 },
  'claude-opus-4-6':           { in: 0.015, out: 0.075, cacheRead: 0.0015,  cacheWrite: 0.01875 },
  'claude-sonnet-4-6':         { in: 0.003, out: 0.015, cacheRead: 0.0003,  cacheWrite: 0.00375 },
  'claude-sonnet-4-5':         { in: 0.003, out: 0.015, cacheRead: 0.0003,  cacheWrite: 0.00375 },
  'claude-haiku-4-5':          { in: 0.001, out: 0.005, cacheRead: 0.0001,  cacheWrite: 0.00125 },
  'claude-haiku-4-5-20251001': { in: 0.001, out: 0.005, cacheRead: 0.0001,  cacheWrite: 0.00125 },
};

const computeCost = (model, usage) => {
  const p = PRICING[model];
  if (!p || !usage) return 0;
  const inp = (usage.input_tokens || 0)               / 1000 * p.in;
  const out = (usage.output_tokens || 0)              / 1000 * p.out;
  const cR  = (usage.cache_read_input_tokens || 0)    / 1000 * p.cacheRead;
  const cW  = (usage.cache_creation_input_tokens || 0)/ 1000 * p.cacheWrite;
  return Number((inp + out + cR + cW).toFixed(6));
};

const summarizeToolUse = (name, input = {}) => {
  if (input.file_path)   return `${name}: ${path.basename(input.file_path)}`;
  if (input.path)        return `${name}: ${path.basename(input.path)}`;
  if (input.command)     return `${name}: ${String(input.command).slice(0, 140)}`;
  if (input.pattern)     return `${name}: /${input.pattern}/`;
  if (input.subject)     return `${name}: ${input.subject}`;
  if (input.url)         return `${name}: ${input.url}`;
  if (input.query)       return `${name}: ${input.query}`;
  if (input.taskId)      return `${name}: #${input.taskId}${input.status ? ' → ' + input.status : ''}`;
  if (input.skill)       return `${name}: ${input.skill}`;
  // Agent / Task: spawning a sub-agent. Surface the friendly name + role.
  if (input.subagent_type || input.name) {
    const display = input.name || input.subagent_type;
    const role = input.subagent_type && input.name && input.subagent_type !== input.name
      ? ` (${input.subagent_type})`
      : '';
    return `${name} → ${display}${role}`;
  }
  return name;
};

const summarizeToolResult = (content) => {
  if (typeof content === 'string') return content.split('\n')[0].slice(0, 220) || '(empty)';
  if (Array.isArray(content)) {
    const text = content.find((c) => c.type === 'text');
    if (text?.text) return text.text.split('\n')[0].slice(0, 220);
  }
  return '(result)';
};

const projectFromCwd = (cwd) => {
  const root = findProjectRoot(cwd);
  return {
    projectId: root,
    projectName: path.basename(root) || root,
    projectPath: root,
  };
};

// ---- Sub-agent attribution helpers ----

// Detect whether a JSONL path is a sub-agent transcript.
const isSubagentFile = (filePath) =>
  filePath.includes(`${path.sep}subagents${path.sep}`);

// Extract the first ~200 chars of the first user-message text payload
// in a JSONL file. Used as the fingerprint we match against parent
// Agent-tool calls.
const firstUserPromptFingerprint = (lines) => {
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'user' || !entry.message) continue;
    const c = entry.message.content;
    let text = '';
    if (typeof c === 'string') text = c;
    else if (Array.isArray(c)) {
      const t = c.find((p) => p.type === 'text');
      if (t?.text) text = t.text;
    }
    if (!text) continue;
    // Strip the <teammate-message …> wrapper some users add around prompts.
    const stripped = text.replace(/^<teammate-message[^>]*>\s*/, '').trim();
    return stripped.slice(0, PROMPT_FINGERPRINT_LEN);
  }
  return null;
};

// Scan a parent session's JSONL for Agent / Task tool calls and add them
// to the global registry, keyed by prompt fingerprint.
const indexAgentCallsInLines = (lines, registry) => {
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message?.content) continue;
    for (const c of entry.message.content) {
      if (c.type !== 'tool_use') continue;
      if (c.name !== 'Agent' && c.name !== 'Task') continue;
      const prompt = c.input?.prompt;
      if (!prompt) continue;
      const fingerprint = String(prompt).slice(0, PROMPT_FINGERPRINT_LEN);
      const friendly = c.input.name || c.input.subagent_type || 'Subagent';
      registry.set(fingerprint, {
        agentName: friendly,
        subagentType: c.input.subagent_type || friendly,
        description: c.input.description || null,
      });
    }
  }
};

// Resolve the agent identity for a sub-agent file by looking up its first
// user prompt in the parent registry. Falls back to "Subagent" if no match.
const resolveSubagentIdentity = (lines, registry) => {
  const fp = firstUserPromptFingerprint(lines);
  if (!fp) return null;
  const exact = registry.get(fp);
  if (exact) return exact;
  // Loose fallback: any registered prompt that this file's prompt starts with.
  for (const [key, val] of registry) {
    if (fp.startsWith(key) || key.startsWith(fp)) return val;
  }
  return null;
};

// ---- Event extraction ----

// Convert one JSONL line into zero or more AgentDash events.
// `fileMeta` carries per-file context that persists across lines:
//   - cwd: cached working directory
//   - subagentName / subagentRole: identity resolved for the whole file
const eventsFromLine = (line, fileMeta) => {
  let entry;
  try { entry = JSON.parse(line); } catch { return []; }

  const cwd = entry.cwd || fileMeta.cwd;
  if (!cwd) return [];

  const project = projectFromCwd(cwd);

  const baseAgent = entry.isSidechain
    ? {
        agentName: fileMeta.subagentName || 'Subagent',
        agentRole: fileMeta.subagentRole || 'sub-agent',
        model: entry.message?.model || 'claude',
      }
    : {
        agentName: 'Main',
        agentRole: 'main',
        model: entry.message?.model || 'claude',
      };

  const ts = entry.timestamp || new Date().toISOString();
  const out = [];

  if (entry.type === 'assistant' && entry.message?.content) {
    for (const c of entry.message.content) {
      if (c.type === 'text') {
        const text = (c.text || '').trim();
        if (text) {
          out.push({
            id: randomUUID(), timestamp: ts, source: 'claude',
            type: 'thought',
            message: text.length > 500 ? text.slice(0, 500) + '…' : text,
            ...project, ...baseAgent,
          });
        }
      } else if (c.type === 'tool_use') {
        out.push({
          id: randomUUID(), timestamp: ts, source: 'claude',
          type: 'tool_call',
          message: summarizeToolUse(c.name, c.input),
          ...project, ...baseAgent,
        });
      }
    }

    if (entry.message.usage) {
      const u = entry.message.usage;
      const tokens = {
        prompt:     (u.input_tokens || 0)
                  + (u.cache_read_input_tokens || 0)
                  + (u.cache_creation_input_tokens || 0),
        completion: u.output_tokens || 0,
      };
      tokens.total = tokens.prompt + tokens.completion;
      out.push({
        id: randomUUID(), timestamp: ts, source: 'claude',
        type: 'tokens',
        message: `prompt=${tokens.prompt} completion=${tokens.completion} total=${tokens.total}`,
        tokens,
        costUsd: computeCost(baseAgent.model, u),
        ...project, ...baseAgent,
      });
    }
  } else if (entry.type === 'user' && entry.message?.content) {
    const c = entry.message.content;
    const items = Array.isArray(c) ? c : [];
    for (const item of items) {
      if (item.type === 'tool_result') {
        const isError = item.is_error === true;
        out.push({
          id: randomUUID(), timestamp: ts, source: 'claude',
          type: isError ? 'error' : 'tool_result',
          message: summarizeToolResult(item.content),
          ...project, ...baseAgent,
        });
      }
    }
  } else if (entry.type === 'permission-mode') {
    out.push({
      id: randomUUID(), timestamp: ts, source: 'claude',
      type: 'system',
      message: `permission mode → ${entry.permissionMode}`,
      ...project, ...baseAgent,
    });
  }

  return out;
};

// ---- File tailing ----

const tailFile = async (filePath, state, onEvent) => {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return; }

  const prev = state.offsets.get(filePath) ?? stat.size;
  if (stat.size <= prev) return;

  const fd = await fsp.open(filePath, 'r');
  try {
    const len = stat.size - prev;
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, prev);
    state.offsets.set(filePath, stat.size);

    const text = (state.partial.get(filePath) || '') + buf.toString('utf8');
    const lines = text.split('\n');
    state.partial.set(filePath, lines.pop() || '');

    // Keep the parent registry up to date with any new Agent calls in
    // this batch (only meaningful for parent-session files).
    if (!isSubagentFile(filePath)) {
      indexAgentCallsInLines(lines, state.agentRegistry);
    }

    for (const line of lines) {
      if (!line.trim()) continue;
      const fileMeta = state.fileMeta.get(filePath) || { cwd: state.cwds.get(filePath) };
      for (const ev of eventsFromLine(line, fileMeta)) {
        if (ev.projectPath) state.cwds.set(filePath, ev.projectPath);
        onEvent(ev);
      }
      state.fileMeta.set(filePath, fileMeta);
    }
  } finally {
    await fd.close();
  }
};

// Seed: emit the tail of recent files. Parent sessions always have their
// Agent calls indexed (we walk the whole file). Sub-agent files have their
// identity resolved against the registry before emitting.
const seedFile = async (filePath, state, onEvent) => {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return; }

  let lines = [];
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    lines = text.split('\n').filter(Boolean);
  } catch {
    state.offsets.set(filePath, stat.size);
    return;
  }

  // Always walk the whole parent file to index Agent calls — the registry
  // will be needed by sub-agent files we encounter.
  if (!isSubagentFile(filePath)) {
    indexAgentCallsInLines(lines, state.agentRegistry);
  }

  // Build per-file context.
  const ctx = { cwd: null };
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.cwd) { ctx.cwd = e.cwd; break; }
    } catch { /* skip */ }
  }

  if (isSubagentFile(filePath)) {
    const id = resolveSubagentIdentity(lines, state.agentRegistry);
    if (id) {
      ctx.subagentName = id.agentName;
      ctx.subagentRole = id.subagentType;
    }
  }

  state.fileMeta.set(filePath, ctx);

  // Skip emission for files that haven't been touched within the recent window.
  if (Date.now() - stat.mtimeMs > BACKFILL_RECENT_MS) {
    state.offsets.set(filePath, stat.size);
    return;
  }

  const tail = lines.slice(-BACKFILL_LINES);
  for (const line of tail) {
    for (const ev of eventsFromLine(line, ctx)) {
      if (ev.projectPath) state.cwds.set(filePath, ev.projectPath);
      onEvent(ev);
    }
  }
  state.offsets.set(filePath, stat.size);
};

// Recursive directory walk that yields every .jsonl file under a project
// folder — including sub-agent files in `<sessionId>/subagents/`.
const findJsonlFiles = async (dir) => {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return out; }

  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const nested = await findJsonlFiles(full);
      out.push(...nested);
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
  return out;
};

export const startClaudeWatcher = async ({ onEvent }) => {
  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) {
    console.warn(`[claude] not found: ${CLAUDE_PROJECTS_ROOT}`);
    return false;
  }

  const state = {
    offsets:        new Map(),  // filePath → byte offset already consumed
    partial:        new Map(),  // filePath → trailing partial line
    cwds:           new Map(),  // filePath → cached cwd
    fileMeta:       new Map(),  // filePath → { cwd, subagentName?, subagentRole? }
    agentRegistry:  new Map(),  // promptFingerprint → { agentName, subagentType, description }
  };

  // Pass 1: index every parent session file's Agent calls FIRST so that
  // sub-agent files can resolve their identity correctly during seeding.
  const projectDirs = await fsp.readdir(CLAUDE_PROJECTS_ROOT);
  const allFiles = [];
  for (const d of projectDirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_ROOT, d);
    const files = await findJsonlFiles(dirPath);
    allFiles.push(...files);
  }

  // Sort: parent sessions first (no /subagents/ in path), so the registry
  // is populated before we resolve sub-agent identities.
  allFiles.sort((a, b) => Number(isSubagentFile(a)) - Number(isSubagentFile(b)));

  for (const full of allFiles) {
    await seedFile(full, state, onEvent);
  }

  const subagentCount = allFiles.filter(isSubagentFile).length;
  console.log(
    `[claude] tracking ${allFiles.length} session file(s) (${subagentCount} sub-agent transcripts), ` +
    `${state.agentRegistry.size} known agent invocations`,
  );

  // Live tail: any change in the tree triggers a re-read of that file.
  fs.watch(CLAUDE_PROJECTS_ROOT, { recursive: true }, async (_eventType, filename) => {
    if (!filename) return;
    const rel = filename.toString();
    if (!rel.endsWith('.jsonl')) return;
    const full = path.join(CLAUDE_PROJECTS_ROOT, rel);

    // First time we see a sub-agent file: try to resolve its identity.
    if (!state.fileMeta.has(full) && isSubagentFile(full)) {
      try {
        const text = await fsp.readFile(full, 'utf8');
        const lines = text.split('\n').filter(Boolean);
        const ctx = {};
        for (const line of lines) {
          try {
            const e = JSON.parse(line);
            if (e.cwd) { ctx.cwd = e.cwd; break; }
          } catch { /* skip */ }
        }
        const id = resolveSubagentIdentity(lines, state.agentRegistry);
        if (id) {
          ctx.subagentName = id.agentName;
          ctx.subagentRole = id.subagentType;
        }
        state.fileMeta.set(full, ctx);
      } catch { /* ignore */ }
    }

    if (!state.offsets.has(full)) state.offsets.set(full, 0);
    try { await tailFile(full, state, onEvent); }
    catch (err) { console.warn(`[claude] tail failed for ${full}: ${err.message}`); }
  });

  return true;
};
