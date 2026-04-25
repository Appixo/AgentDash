// SQLite event store.
//
// Replaces the in-memory ring buffer. Every event the backend broadcasts is
// also persisted here, so:
//   - history survives restarts
//   - new clients can replay the last N events for the project they're
//     currently viewing (instead of a global, capped-at-5000 buffer)
//   - the upcoming Supervisor Chat feature can run ad-hoc queries
//     ("every error in the last 24h", "all tool_calls by Yusuf this week")
//
// `tokens` is stored as a JSON string because better-sqlite3 doesn't support
// nested types and we don't need to query into it. `costUsd` is REAL so we
// can sum it cheaply for cost reports.

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'agentdash.db');

let db;
let insertStmt;
let recentByProjectStmt;
let recentGlobalStmt;
let countStmt;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    type        TEXT,
    message     TEXT,
    timestamp   TEXT,
    source      TEXT,
    projectId   TEXT,
    projectName TEXT,
    projectPath TEXT,
    agentName   TEXT,
    agentRole   TEXT,
    model       TEXT,
    tokens      TEXT,    -- JSON-stringified { prompt, completion, total }
    costUsd     REAL
  );

  CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events(projectId, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_events_ts         ON events(timestamp DESC);
`;

export const initDb = () => {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL'); // safer with concurrent reads
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);

  insertStmt = db.prepare(`
    INSERT OR IGNORE INTO events
      (id, type, message, timestamp, source, projectId, projectName, projectPath,
       agentName, agentRole, model, tokens, costUsd)
    VALUES
      (@id, @type, @message, @timestamp, @source, @projectId, @projectName, @projectPath,
       @agentName, @agentRole, @model, @tokens, @costUsd)
  `);

  recentByProjectStmt = db.prepare(`
    SELECT * FROM events
    WHERE projectId = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  recentGlobalStmt = db.prepare(`
    SELECT * FROM events
    ORDER BY timestamp DESC
    LIMIT ?
  `);

  countStmt = db.prepare(`SELECT COUNT(*) AS n FROM events`);

  console.log(`[db] sqlite ready at ${DB_PATH} (${countStmt.get().n} events on disk)`);
  return db;
};

// Normalise an event into the row shape. Anything missing → null.
const toRow = (event) => ({
  id:          event.id || null,
  type:        event.type || null,
  message:     event.message || null,
  timestamp:   event.timestamp || new Date().toISOString(),
  source:      event.source || null,
  projectId:   event.projectId || null,
  projectName: event.projectName || null,
  projectPath: event.projectPath || null,
  agentName:   event.agentName || null,
  agentRole:   event.agentRole || null,
  model:       event.model || null,
  tokens:      event.tokens ? JSON.stringify(event.tokens) : null,
  costUsd:     typeof event.costUsd === 'number' ? event.costUsd : null,
});

// Reverse: row → wire-shape event.
const fromRow = (row) => ({
  ...row,
  tokens:  row.tokens ? safeParse(row.tokens) : undefined,
  costUsd: row.costUsd == null ? undefined : row.costUsd,
});

const safeParse = (s) => { try { return JSON.parse(s); } catch { return undefined; } };

// Insert one event. Idempotent on `id` (re-tailing a session won't dup).
export const insertEvent = (event) => {
  if (!db || !insertStmt) return;
  if (!event.id) return;            // skip ad-hoc system events without ids
  try { insertStmt.run(toRow(event)); }
  catch (err) { console.warn(`[db] insert failed: ${err.message}`); }
};

// Last N events for a project, returned in chronological order so the
// frontend can append them to its buffer without resorting.
export const recentForProject = (projectId, limit = 1000) => {
  if (!db || !recentByProjectStmt) return [];
  const rows = recentByProjectStmt.all(projectId, limit);
  return rows.reverse().map(fromRow);
};

// Last N events across all projects (used for the "All projects" view).
export const recentGlobal = (limit = 1000) => {
  if (!db || !recentGlobalStmt) return [];
  const rows = recentGlobalStmt.all(limit);
  return rows.reverse().map(fromRow);
};
