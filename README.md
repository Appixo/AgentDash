# AgentDash

> Real-time, open-source **AI Workforce Management** dashboard for Claude Code (and other AI agent CLIs).

AgentDash treats you as the **Scrum Master** of a team of autonomous AI agents. It gives you live visibility into what every agent is doing across every project, what it's costing, and how close you are to your plan limits — without leaving the dashboard.

![MIT License](https://img.shields.io/badge/license-MIT-green) ![Status](https://img.shields.io/badge/status-active-blue)

---

## Why

Autonomous AI agents are a black box. You launch them, they do work, and you find out what happened by reading transcripts after the fact. AgentDash flips that:

- **See every thought, tool call, and error in real time** — across every project on your machine.
- **Track productivity** — which agent is shipping vs spinning in error loops.
- **Track financial burn** — how much each project, agent, and model has cost so far.
- **Stay under plan limits** — % of session / weekly / Sonnet budgets, with over-budget alerts.
- **Make Go/No-Go calls** — kill the runaway, fund the producer.

---

## Features

### Live observability
- **Tails every Claude Code session** automatically (`~/.claude/projects/*.jsonl` + sub-agent transcripts) — no setup, no wrapping CLIs.
- **Multi-project, multi-agent** with stable color-coding per agent across the whole UI.
- **Sub-agent attribution**: when Claude spawns `Agent(subagent_type: "yusuf-lead-architect", …)`, the resulting sidechain transcript is correctly labeled `yusuf` in the feed and roster.
- **Refresh-safe**: SQLite-backed event store (`better-sqlite3`) — history survives restarts, replays the last 1000 events for the active project on connect.

### Plan-usage tracking
- Three rolling-window bars at the top: **Current session (5h) · Weekly (all models) · Weekly (Sonnet only)** — mirrors Claude's settings page.
- **Plan presets** (Pro / Max 5x / Max 20x / Custom) with USD budgets you can fine-tune so percentages line up with what Anthropic shows you.
- **Disk-wide cost aggregation** — scans every JSONL, prices each message against its actual `model` (incl. cache_read / cache_write rates).

### Scrum Master cockpit
- **TeamRoster** table merging configured agents (`<project>/.claude/agents/*.md`) with live runtime stats. Idle agents collapse below a divider; active ones sort by burn.
- **Per-agent "Session %"** with an `OVER` warning when an agent crosses 100% of budget alone.
- **Tier-colored model badges**: Haiku (teal) · Sonnet (sky) · Opus (violet) — see at a glance who's burning premium models.

### Searchable feed
- Sticky search bar with `/` and `Ctrl/Cmd+F` hotkeys.
- **Filter pills** for event type (thought / tool / result / tokens / error) and agent name (with live counts).
- Match-highlighting inline. Error rows get a red-tinted background.

### Charts
- Tokens-by-agent (stacked area) · Session burn % per 10s · Errors per 10s — totals baked into the card titles.

---

## Architecture

```
┌─────────────────────────┐  JSONL tail / spawn  ┌──────────────┐  WebSocket   ┌──────────────┐
│  Claude Code sessions   │ ──────────────────── │   Backend    │ ───────────► │   Frontend   │
│  (~/.claude/projects/   │  + custom CLIs       │  Express +   │  agent:event │  Next.js +   │
│   *.jsonl)              │  (opt-in spawn mode) │  Socket.io + │  agent:reply │  Tailwind +  │
│                         │                      │  SQLite      │              │  Recharts    │
└─────────────────────────┘                      └──────────────┘              └──────────────┘
                                                  HTTP: /projects /agents /usage /health
```

### Monorepo layout

```
AgentDash/
├── backend/                     Node 20 + Express + Socket.io + better-sqlite3
│   ├── src/
│   │   ├── server.js            HTTP/WS bootstrap, modes, replay-on-connect
│   │   ├── claudeWatcher.js     Tails Claude Code JSONL transcripts + sub-agent attribution
│   │   ├── agentRunner.js       child_process.spawn wrapper (opt-in)
│   │   ├── parser.js            Generic line parser for spawned CLIs
│   │   ├── db.js                SQLite event store
│   │   ├── projectRoot.js       Walk cwd → nearest .git
│   │   ├── projectDiscovery.js  /projects endpoint
│   │   ├── agentDiscovery.js    /agents endpoint (parses .claude/agents/*.md)
│   │   ├── usageAggregator.js   /usage endpoint (disk-wide cost tally)
│   │   ├── projectWatcher.js    Legacy raw fs.watch (off by default)
│   │   └── dummyStream.js       Synthetic team for demos
│   ├── projects.config.json     Optional: spawn-mode CLI projects
│   └── data/                    SQLite DB (gitignored)
└── frontend/                    Next.js App Router
    ├── app/
    └── components/
        ├── Dashboard.jsx        Owns event stream, plan-usage panel
        ├── Sidebar.jsx          Active/Inactive sections, drag-to-reorder
        ├── UsageBar.jsx         Session/weekly bars (with OVER warning)
        ├── BudgetEditor.jsx     Plan picker + USD budget tuning
        ├── TeamRoster.jsx       Active + collapsible idle agent rows
        ├── MetricsRow.jsx       3 dense Recharts cards
        ├── TerminalFeed.jsx     Search + filter pills + auto-scroll
        ├── EventRow.jsx         Color-coded rows (error highlight, tier badge)
        └── …
```

---

## Quick start

Requires **Node.js 20+** and Claude Code already installed (so `~/.claude/projects/` exists).

```bash
# Backend
cd backend
npm install
npm run dev
# → [claude] tracking N session file(s) under ~/.claude/projects
# → [http] AgentDash backend listening on :4000

# Frontend (in a second terminal)
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

Open **http://localhost:3000** — every active Claude Code session you have will appear in the sidebar within seconds.

### Demo mode (no Claude Code required)

```bash
cd backend
npm run dev:dummy
```

A synthetic 5-agent team across 2 projects will produce a continuous stream of realistic events.

---

## Configuration

### Environment variables (backend)

| Variable | Default | What |
|----------|---------|------|
| `PORT` | `4000` | Backend HTTP/WS port |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | CORS origin |
| `AGENT_MODE` | `auto` | `auto` (Claude tail + spawn config), `dummy`, `claude`, `config` |
| `PROJECTS_CONFIG` | `backend/projects.config.json` | Path to spawn-mode config |

### Environment variables (frontend)

| Variable | Default | What |
|----------|---------|------|
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:4000` | Where the dashboard connects |

### Plan presets

The Session / Weekly / Sonnet bars are computed against USD budgets that approximate Anthropic's server-side limits. Click **plan: …** in the header to pick:

| Plan | Session | Weekly · all | Weekly · Sonnet |
|------|---------|--------------|-----------------|
| Pro ($20/mo) | $12 | $80 | $30 |
| Max 5x ($100/mo) | $58 | $394 | $150 |
| Max 20x ($200/mo) | $232 | $1576 | $600 |
| Custom | — | — | — |

Defaults are back-solved from real Max 5x usage data; you can fine-tune the dollar fields and AgentDash will stay calibrated. Saved to `localStorage`.

### Wrapping a non-Claude CLI (advanced)

Add an entry to `backend/projects.config.json`:

```json
{
  "projects": [
    {
      "projectId":   "proj-custom",
      "projectName": "MyAgent",
      "projectPath": "C:/path/to/project",
      "agentName":   "Worker",
      "agentRole":   "coder",
      "model":       "gpt-4o",
      "mode":        "spawn",
      "cmd":         "node",
      "args":        ["scripts/agent.js"]
    }
  ]
}
```

The CLI's stdout/stderr is parsed line-by-line. Lines prefixed with `THOUGHT:`, `TOOL:`, `RESULT:`, `ERROR:`, or `TOKENS:` map to typed events; anything else falls through as `log`.

---

## Event schema (the wire contract)

```json
{
  "id": "uuid",
  "type": "thought | tool_call | tool_result | error | tokens | system | log",
  "message": "...",
  "timestamp": "ISO-8601",
  "source": "claude | stdout | stderr",

  "projectId":   "<git root path>",
  "projectName": "<repo basename>",
  "projectPath": "<git root path>",

  "agentName":   "Main | <subagent_type or friendly name>",
  "agentRole":   "main | sub-agent",
  "model":       "claude-opus-4-7 | claude-sonnet-4-6 | …",

  "tokens":  { "prompt": 1240, "completion": 312, "total": 1552 },
  "costUsd": 0.0042
}
```

`tokens` and `costUsd` are present on `tokens`-type events; other types may omit them.

---

## HTTP endpoints

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/health` | `{ status, mode, replayLimit }` |
| `GET` | `/projects` | Every Claude project on disk with last-activity timestamp |
| `GET` | `/agents?projectPath=…` | Configured agents from that project's `.claude/agents/*.md` |
| `GET` | `/usage` | Disk-wide rolling 5h/7d/Sonnet cost totals |

WebSocket events: `agent:event` (push), `agent:replay` (push, on connect / project switch), `agent:requestReplay` (client → server, with `projectId`).

---

## Roadmap

| Phase | Goal | Status |
|------:|------|:-------|
| 1 | WebSocket pipe with dummy stream | done |
| 2 | Multi-project + multi-agent schema, redesigned UI | done |
| 3 | Scrum Master UI: TeamRoster, project cost banner, productivity & burn aggregates | done |
| 4 | Claude Code JSONL tailing as primary signal source | done |
| 5 | Plan-usage limits (% of session/weekly/Sonnet budgets) + plan picker | done |
| 6 | Disk-wide cost aggregator + agent discovery from `.claude/agents/*.md` | done |
| 7 | Feed search + filter pills | done |
| 8 | SQLite persistence (`better-sqlite3`) | done |
| 9 | Supervisor Chat (meta-analysis with Claude over recent events) | planned |
| 10 | Intervention controls (Kill / Pause → SIGINT/SIGKILL) | planned |
| 11 | Desktop app (Electron / Tauri) | planned |

---

## Limitations

- **Anthropic plan auto-detection isn't possible** — plan info lives server-side, no public API exposes it. AgentDash uses the plan picker + USD budget approximation instead.
- **Cost numbers are estimates** — based on published per-token API pricing (incl. cache rates). Anthropic uses internal compute units against your plan, so percentages may differ by 5–15%.
- **Reset countdowns are rolling, not aligned** — Anthropic uses fixed boundaries ("Tue 9:00 AM"); AgentDash uses `oldest_event + window − now`, so countdowns drift slightly.

---

## Contributing

This is a public, MIT-licensed project. Issues and PRs welcome. The codebase is intentionally small and modular — read `backend/src/server.js` and `frontend/components/Dashboard.jsx` first; everything else is a focused module called from there.

## License

MIT
