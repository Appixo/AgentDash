// Agent discovery.
//
// Reads the per-project agent roster from `.claude/agents/*.md` (and the
// user-global `~/.claude/agents/*.md` as a fallback). Each file has YAML
// frontmatter with at least `name` + `description`, and usually `model`
// and `tools`. The `name` value is what `Task(subagent_type: …)` uses, so
// this is the same identifier that ends up on agent events at runtime —
// allowing the TeamRoster to merge configured agents with their live stats.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Minimal YAML frontmatter parser. We only need scalar fields, not nested
// structures, so a regex-based scan is sufficient and avoids a YAML dep.
const parseFrontmatter = (content) => {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = content.slice(4, end);
  const result = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // Strip surrounding quotes if any.
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[m[1]] = value;
  }
  return result;
};

// Extract the human-friendly name from the description if it follows the
// "FirstName — Role" convention these agent files use. Falls back to
// title-casing the first slug segment.
const friendlyDisplay = (name, description) => {
  if (description) {
    // "Ayşe — strategic-tier Product Analyst" → "Ayşe"
    // "Can - routine-tier Issue Triager"      → "Can"
    const m = description.match(/^([^—\-–]+?)\s*[—\-–]/);
    if (m) return m[1].trim();
  }
  const first = (name || '').split('-')[0] || name || '';
  return first.charAt(0).toUpperCase() + first.slice(1);
};

// Best-effort role extraction — the part after the dash, trimmed of
// "tier" / "Use PROACTIVELY" / etc. Used purely for the roster's Role column.
const extractRole = (description) => {
  if (!description) return null;
  const m = description.match(/[—\-–]\s*([^.]+?)\.\s/);
  if (!m) return null;
  return m[1].replace(/\b(strategic|implementation|routine|specialist)-tier\s+/i, '').trim();
};

const readAgentsDir = async (dir, scope) => {
  if (!fs.existsSync(dir)) return [];
  let entries;
  try { entries = await fsp.readdir(dir); } catch { return []; }

  const agents = [];
  for (const f of entries) {
    if (!f.endsWith('.md')) continue;
    const filePath = path.join(dir, f);
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const fm = parseFrontmatter(raw) || {};
      const name = fm.name || f.replace(/\.md$/, '');
      agents.push({
        name,                                    // Task subagent_type identifier
        displayName: friendlyDisplay(name, fm.description),
        role: extractRole(fm.description) || fm.role || 'agent',
        description: fm.description || '',
        model: fm.model || null,
        tools: fm.tools ? fm.tools.split(',').map((s) => s.trim()) : [],
        scope,                                   // 'project' | 'user'
        file: filePath,
      });
    } catch { /* skip unreadable */ }
  }
  return agents;
};

// For a given project root, return the merged list of agents the user has
// defined for that project. Project-local agents shadow user-global ones
// of the same name.
export const discoverProjectAgents = async (projectPath) => {
  const projectAgents = await readAgentsDir(
    path.join(projectPath, '.claude', 'agents'),
    'project',
  );
  const globalAgents = await readAgentsDir(
    path.join(os.homedir(), '.claude', 'agents'),
    'user',
  );

  const seen = new Map();
  for (const a of [...projectAgents, ...globalAgents]) {
    if (!seen.has(a.name)) seen.set(a.name, a);
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
};
