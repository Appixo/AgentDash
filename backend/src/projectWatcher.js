// Project file-system watcher.
//
// Observes a real project directory and emits a structured agent event for
// every file change. This is the "real activity, zero setup" mode — useful
// when no AI CLI is being wrapped but the user still wants live signal from
// their actual work (their own edits, an external editor saving, an AI
// tool like Claude Code modifying files in that folder, etc.).
//
// Implementation notes:
//   - Uses Node's built-in fs.watch with { recursive: true } (works on
//     Windows + macOS; Linux falls back to a one-level watch).
//   - Coalesces duplicate events fired within 50ms per path (editors often
//     trigger 2-3 change notifications per save).
//   - Honors a per-project ignore list to skip noisy folders like
//     node_modules / .next / .git.

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const COALESCE_MS = 50;

const isIgnored = (relPath, ignore = []) => {
  if (!relPath) return false;
  const segments = relPath.split(/[\\/]/);
  return ignore.some((token) => segments.includes(token));
};

// Best-effort classification so the dashboard can color the row.
const classify = (relPath, eventType) => {
  if (eventType === 'rename') return 'tool_call';   // create / delete / move
  if (relPath.endsWith('.md')) return 'thought';    // notes / docs / planning
  if (relPath.endsWith('.test.js') || relPath.endsWith('.spec.js')) return 'tool_result';
  return 'tool_call';                               // edit
};

const describe = (relPath, eventType, exists) => {
  if (eventType === 'rename') {
    return exists ? `created: ${relPath}` : `deleted: ${relPath}`;
  }
  return `edited: ${relPath}`;
};

export const startProjectWatcher = ({ project, onEvent }) => {
  const root = project.projectPath;

  if (!fs.existsSync(root)) {
    onEvent({
      id: randomUUID(),
      type: 'error',
      message: `Project path does not exist: ${root}`,
      timestamp: new Date().toISOString(),
      projectId: project.projectId,
      projectName: project.projectName,
      projectPath: root,
      agentName: project.agentName,
      agentRole: project.agentRole,
      model: project.model,
    });
    return null;
  }

  const lastSeen = new Map();
  const ignore = project.ignore || [];

  let watcher;
  try {
    watcher = fs.watch(root, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (isIgnored(rel, ignore)) return;

      // Coalesce burst-fired events for the same path.
      const now = Date.now();
      const last = lastSeen.get(rel) || 0;
      if (now - last < COALESCE_MS) return;
      lastSeen.set(rel, now);

      const abs = path.join(root, rel);
      let exists = true;
      try { fs.statSync(abs); } catch { exists = false; }

      onEvent({
        id: randomUUID(),
        type: classify(rel, eventType),
        message: describe(rel, eventType, exists),
        timestamp: new Date().toISOString(),
        source: 'fs.watch',
        projectId: project.projectId,
        projectName: project.projectName,
        projectPath: root,
        agentName: project.agentName,
        agentRole: project.agentRole,
        model: project.model,
      });
    });
  } catch (err) {
    onEvent({
      id: randomUUID(),
      type: 'error',
      message: `Failed to watch ${root}: ${err.message}`,
      timestamp: new Date().toISOString(),
      projectId: project.projectId,
      projectName: project.projectName,
      projectPath: root,
      agentName: project.agentName,
      agentRole: project.agentRole,
      model: project.model,
    });
    return null;
  }

  // Boot event so the project shows up in the sidebar immediately, before
  // the user has touched anything.
  onEvent({
    id: randomUUID(),
    type: 'system',
    message: `Watching ${root}`,
    timestamp: new Date().toISOString(),
    projectId: project.projectId,
    projectName: project.projectName,
    projectPath: root,
    agentName: project.agentName,
    agentRole: project.agentRole,
    model: project.model,
  });

  console.log(`[watch] ${project.projectName} → ${root}`);
  return watcher;
};
