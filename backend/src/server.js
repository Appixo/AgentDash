// AgentDash backend entrypoint.
//
// Boots an Express HTTP server, attaches Socket.io for the realtime channel,
// and starts the Claude session tailer by default — so the dashboard only
// shows real Claude activity, attributed to the project where each session
// is running. Optional projects.config.json can layer additional spawn-mode
// CLI projects on top.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

import { startDummyStream } from './dummyStream.js';
import { startAgentProcess } from './agentRunner.js';
import { startClaudeWatcher } from './claudeWatcher.js';
import { discoverClaudeProjects } from './projectDiscovery.js';
import { discoverProjectAgents } from './agentDiscovery.js';
import { aggregateUsage } from './usageAggregator.js';
import { initDb, insertEvent, recentForProject, recentGlobal } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 4000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

// AGENT_MODE=auto    → tail Claude sessions (default), plus any spawn config
// AGENT_MODE=dummy   → force the synthetic team stream
// AGENT_MODE=claude  → tail Claude sessions only
// AGENT_MODE=config  → spawn-only, require projects.config.json
const AGENT_MODE = process.env.AGENT_MODE || 'auto';

const CONFIG_PATH = process.env.PROJECTS_CONFIG
  || path.resolve(__dirname, '..', 'projects.config.json');

const loadProjectsConfig = () => {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.projects) ? parsed.projects : null;
  } catch (err) {
    console.error(`[config] failed to parse ${CONFIG_PATH}: ${err.message}`);
    return null;
  }
};

// SQLite-backed event store. Replaces the old in-memory ring buffer so
// history survives restarts and we can answer per-project queries.
initDb();

const REPLAY_LIMIT = 1000;

const app = express();
app.use(cors({ origin: FRONTEND_ORIGIN }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: AGENT_MODE, replayLimit: REPLAY_LIMIT });
});

// Discovery: every Claude project on disk, with last-activity timestamps.
// The frontend uses this to render the "Inactive projects" section so the
// user can see workspaces they've previously opened, not just live ones.
app.get('/projects', async (_req, res) => {
  try {
    const projects = await discoverClaudeProjects();
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Account-wide usage tally. Scans every JSONL transcript on disk and
// returns rolling-window cost totals for the session / weekly / weekly-sonnet
// limits — so the dashboard reflects the user's full Claude Code spend,
// not just sessions AgentDash has tailed since boot.
app.get('/usage', async (_req, res) => {
  try {
    const usage = await aggregateUsage();
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Per-project agent roster from <project>/.claude/agents/*.md (with
// ~/.claude/agents/*.md as user-global fallback). Lets the dashboard show
// every configured team member, including idle ones with zero activity.
app.get('/agents', async (req, res) => {
  const projectPath = req.query.projectPath;
  if (!projectPath || typeof projectPath !== 'string') {
    return res.status(400).json({ error: 'projectPath query param required' });
  }
  try {
    const agents = await discoverProjectAgents(projectPath);
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: FRONTEND_ORIGIN, methods: ['GET', 'POST'] },
});

// Persist + broadcast. We persist BEFORE emitting so a client connecting
// at the same instant always sees a consistent on-disk view.
const broadcast = (event) => {
  insertEvent(event);
  io.emit('agent:event', event);
};

// Build a replay payload for a connecting client. If they tell us which
// project they're viewing we return that project's history; otherwise the
// most recent N events across everything.
const buildReplay = (projectId) => {
  if (projectId && projectId !== '__all__') {
    return recentForProject(projectId, REPLAY_LIMIT);
  }
  return recentGlobal(REPLAY_LIMIT);
};

io.on('connection', (socket) => {
  console.log(`[ws] client connected: ${socket.id}`);

  // Initial handshake: client may immediately ask for a per-project replay.
  // If it doesn't, we send a sensible default (recent global activity).
  const handleReplayRequest = (projectId) => {
    const events = buildReplay(projectId);
    socket.emit('agent:replay', events);
    socket.emit('agent:event', {
      type: 'system',
      message: `Replayed ${events.length} event(s)${projectId && projectId !== '__all__' ? ` for ${projectId}` : ' across all projects'}`,
      timestamp: new Date().toISOString(),
    });
  };

  socket.on('agent:requestReplay', handleReplayRequest);
  // Default replay (used when the client hasn't bound a selection yet).
  handleReplayRequest(null);

  socket.on('disconnect', (reason) => {
    console.log(`[ws] client disconnected: ${socket.id} (${reason})`);
  });
});

// Start any spawn-mode projects from the config file. We intentionally skip
// any "watch" entries here — raw fs watching has been replaced by the
// Claude session tailer for noise-free, agent-attributed events.
const startSpawnProjects = (projects) => {
  let started = 0;
  for (const project of projects) {
    if ((project.mode || 'spawn') !== 'spawn') continue;
    const child = startAgentProcess({ project, onEvent: broadcast });
    if (child) started += 1;
  }
  return started;
};

httpServer.listen(PORT, async () => {
  console.log(`[http] AgentDash backend listening on :${PORT}`);
  console.log(`[http] CORS origin allowed: ${FRONTEND_ORIGIN}`);

  if (AGENT_MODE === 'dummy') {
    startDummyStream(broadcast);
    return;
  }

  let claudeStarted = false;
  if (AGENT_MODE === 'auto' || AGENT_MODE === 'claude') {
    claudeStarted = await startClaudeWatcher({ onEvent: broadcast });
  }

  let spawnStarted = 0;
  if (AGENT_MODE === 'auto' || AGENT_MODE === 'config') {
    const projects = loadProjectsConfig();
    if (projects?.length) {
      console.log(`[config] loaded ${projects.length} project(s) from ${CONFIG_PATH}`);
      spawnStarted = startSpawnProjects(projects);
    }
  }

  if (!claudeStarted && spawnStarted === 0) {
    if (AGENT_MODE === 'config') {
      console.error('[config] no spawn projects configured');
      process.exit(1);
    }
    console.warn('[fallback] no real sources active — using dummy stream');
    startDummyStream(broadcast);
  }
});

const shutdown = (signal) => {
  console.log(`\n[shutdown] received ${signal}, closing server...`);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
