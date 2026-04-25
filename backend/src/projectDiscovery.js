// Project discovery.
//
// Enumerates every Claude Code project the user has ever started a session
// in, by scanning ~/.claude/projects/*. For each project we return the real
// `cwd` (read from the first line of the most-recent transcript), the
// folder basename as projectName, and the most-recent activity timestamp.
//
// The sidebar uses lastActivity to split projects into "Active" (recent) and
// "Inactive" (everything else) sections.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { findProjectRoot } from './projectRoot.js';

const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects');

// Read just enough of a JSONL to grab the cwd from its first line.
const readCwdFromJsonl = async (filePath) => {
  let fd;
  try {
    fd = await fsp.open(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const { bytesRead } = await fd.read(buf, 0, 2048, 0);
    const text = buf.slice(0, bytesRead).toString('utf8');
    const firstLine = text.split('\n').find(Boolean);
    if (!firstLine) return null;
    const entry = JSON.parse(firstLine);
    return entry.cwd || null;
  } catch {
    return null;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
};

export const discoverClaudeProjects = async () => {
  if (!fs.existsSync(CLAUDE_PROJECTS_ROOT)) return [];

  const dirs = await fsp.readdir(CLAUDE_PROJECTS_ROOT);
  const projects = [];

  for (const d of dirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_ROOT, d);
    let entries;
    try { entries = await fsp.readdir(dirPath); } catch { continue; }

    let mostRecentMs = 0;
    let mostRecentFile = null;
    let sessionCount = 0;
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue;
      sessionCount += 1;
      try {
        const stat = await fsp.stat(path.join(dirPath, f));
        if (stat.mtimeMs > mostRecentMs) {
          mostRecentMs = stat.mtimeMs;
          mostRecentFile = path.join(dirPath, f);
        }
      } catch { /* skip */ }
    }
    if (!mostRecentFile) continue;

    const cwd = await readCwdFromJsonl(mostRecentFile);
    if (!cwd) continue;

    // Roll up to the repo root so subfolder sessions merge under one project.
    const root = findProjectRoot(cwd);

    projects.push({
      projectId: root,
      projectName: path.basename(root) || root,
      projectPath: root,
      lastActivity: new Date(mostRecentMs).toISOString(),
      lastActivityMs: mostRecentMs,
      sessionCount,
    });
  }

  // Multiple Claude folders can resolve to the same repo root (one Claude
  // session per subfolder). Merge them: keep the newest activity, sum the
  // session counts.
  const merged = new Map();
  for (const p of projects) {
    const prev = merged.get(p.projectId);
    if (!prev) {
      merged.set(p.projectId, p);
    } else {
      prev.sessionCount += p.sessionCount;
      if (p.lastActivityMs > prev.lastActivityMs) {
        prev.lastActivityMs = p.lastActivityMs;
        prev.lastActivity = p.lastActivity;
      }
    }
  }

  // Newest first — the frontend will further split into active/inactive.
  return Array.from(merged.values()).sort((a, b) => b.lastActivityMs - a.lastActivityMs);
};
