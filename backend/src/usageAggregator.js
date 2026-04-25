// Disk-wide usage aggregator.
//
// Mirrors what Anthropic's "Plan usage limits" page shows: the user's
// account-wide token spend in the rolling session and weekly windows. The
// in-memory event buffer only sees what AgentDash has tailed since boot,
// so it misses Sonnet runs from yesterday, Haiku side-tasks from this
// morning, etc. To get a complete picture we scan every JSONL transcript
// under ~/.claude/projects/ and re-tally from disk.
//
// Caches per-file results keyed by mtime — repeat calls are nearly free.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const SESSION_WINDOW_MS = 5 * HOUR;
const WEEKLY_WINDOW_MS = 7 * DAY;

const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

// Same pricing table as the live tailer. Cache reads dominate spend on long
// Claude Code conversations, so accounting for them separately matters.
const PRICING = {
  'claude-opus-4-7':   { in: 0.015, out: 0.075, cacheRead: 0.0015,  cacheWrite: 0.01875 },
  'claude-opus-4-6':   { in: 0.015, out: 0.075, cacheRead: 0.0015,  cacheWrite: 0.01875 },
  'claude-sonnet-4-6': { in: 0.003, out: 0.015, cacheRead: 0.0003,  cacheWrite: 0.00375 },
  'claude-sonnet-4-5': { in: 0.003, out: 0.015, cacheRead: 0.0003,  cacheWrite: 0.00375 },
  'claude-haiku-4-5':  { in: 0.001, out: 0.005, cacheRead: 0.0001,  cacheWrite: 0.00125 },
  'claude-haiku-4-5-20251001': { in: 0.001, out: 0.005, cacheRead: 0.0001, cacheWrite: 0.00125 },
};

const computeCost = (model, usage) => {
  const p = PRICING[model] || PRICING['claude-sonnet-4-6'];
  if (!usage) return 0;
  const inp = (usage.input_tokens || 0)               / 1000 * p.in;
  const out = (usage.output_tokens || 0)              / 1000 * p.out;
  const cR  = (usage.cache_read_input_tokens || 0)    / 1000 * p.cacheRead;
  const cW  = (usage.cache_creation_input_tokens || 0)/ 1000 * p.cacheWrite;
  return inp + out + cR + cW;
};

// Per-file cache. Keyed by absolute file path. Each entry stores the mtime
// at which it was parsed plus the FULL list of (timestamp, model, cost)
// triples — small enough that we can re-window cheaply on each /usage call.
const fileCache = new Map();

const parseFile = async (filePath, mtimeMs) => {
  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.entries;

  const out = [];
  let content;
  try { content = await fsp.readFile(filePath, 'utf8'); }
  catch { return out; }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message?.usage) continue;
    const tMs = new Date(entry.timestamp).getTime();
    if (Number.isNaN(tMs)) continue;
    const model = entry.message.model || '';
    out.push({
      tMs,
      model,
      cost: computeCost(model, entry.message.usage),
    });
  }

  fileCache.set(filePath, { mtimeMs, entries: out });
  return out;
};

export const aggregateUsage = async () => {
  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) {
    return emptyUsage();
  }

  const now = Date.now();
  const sessionCutoff = now - SESSION_WINDOW_MS;
  const weeklyCutoff = now - WEEKLY_WINDOW_MS;

  let sessionCost = 0, weeklyCost = 0, weeklySonnetCost = 0;
  let oldestSession = now, oldestWeekly = now, oldestWeeklySonnet = now;
  let sessionCount = 0, weeklyCount = 0, weeklySonnetCount = 0;
  let scannedFiles = 0;

  const projectDirs = await fsp.readdir(CLAUDE_PROJECTS_ROOT);
  for (const d of projectDirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_ROOT, d);
    let entries;
    try { entries = await fsp.readdir(dirPath); } catch { continue; }
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      const filePath = path.join(dirPath, f);

      let stat;
      try { stat = await fsp.stat(filePath); } catch { continue; }
      // Skip files that haven't been written to in the entire weekly window.
      if (stat.mtimeMs < weeklyCutoff) continue;

      const fileEntries = await parseFile(filePath, stat.mtimeMs);
      scannedFiles += 1;

      for (const e of fileEntries) {
        if (e.tMs < weeklyCutoff) continue;
        weeklyCost += e.cost;
        weeklyCount += 1;
        if (e.tMs < oldestWeekly) oldestWeekly = e.tMs;

        if (/sonnet/i.test(e.model)) {
          weeklySonnetCost += e.cost;
          weeklySonnetCount += 1;
          if (e.tMs < oldestWeeklySonnet) oldestWeeklySonnet = e.tMs;
        }

        if (e.tMs >= sessionCutoff) {
          sessionCost += e.cost;
          sessionCount += 1;
          if (e.tMs < oldestSession) oldestSession = e.tMs;
        }
      }
    }
  }

  return {
    scannedAt: new Date(now).toISOString(),
    scannedFiles,
    session:      windowReport(sessionCost,      sessionCount,      oldestSession,      now, SESSION_WINDOW_MS),
    weeklyAll:    windowReport(weeklyCost,       weeklyCount,       oldestWeekly,       now, WEEKLY_WINDOW_MS),
    weeklySonnet: windowReport(weeklySonnetCost, weeklySonnetCount, oldestWeeklySonnet, now, WEEKLY_WINDOW_MS),
  };
};

const windowReport = (cost, count, oldestMs, now, windowMs) => ({
  cost: Number(cost.toFixed(4)),
  count,
  resetsInMs: count > 0 ? Math.max(0, oldestMs + windowMs - now) : windowMs,
  oldestEventAt: count > 0 ? new Date(oldestMs).toISOString() : null,
});

const emptyUsage = () => ({
  scannedAt: new Date().toISOString(),
  scannedFiles: 0,
  session:      windowReport(0, 0, Date.now(), Date.now(), SESSION_WINDOW_MS),
  weeklyAll:    windowReport(0, 0, Date.now(), Date.now(), WEEKLY_WINDOW_MS),
  weeklySonnet: windowReport(0, 0, Date.now(), Date.now(), WEEKLY_WINDOW_MS),
});
