// Dummy multi-project, multi-agent stream.
//
// Simulates two concurrent projects, each with a small team of named agents
// running on different models. Every line still flows through the real
// parser, so the events the frontend receives are byte-for-byte the shape
// production traffic will use.

import { Readable } from 'node:stream';
import { attachLineParser } from './parser.js';

const PROJECTS = [
  {
    projectId: 'proj-agentdash',
    projectName: 'AgentDash',
    projectPath: 'C:/Users/abdul/OneDrive/Documenten/GitHub/AgentDash',
    agents: [
      { agentName: 'Planner',  agentRole: 'planner',  model: 'claude-opus-4-7' },
      { agentName: 'Coder',    agentRole: 'coder',    model: 'claude-sonnet-4-6' },
      { agentName: 'Reviewer', agentRole: 'reviewer', model: 'claude-haiku-4-5' },
    ],
  },
  {
    projectId: 'proj-prayertime',
    projectName: 'PrayerTime',
    projectPath: 'C:/Users/abdul/OneDrive/Documenten/GitHub/PrayerTime',
    agents: [
      { agentName: 'Researcher', agentRole: 'researcher', model: 'gpt-4o' },
      { agentName: 'Builder',    agentRole: 'coder',      model: 'claude-sonnet-4-6' },
    ],
  },
];

// A short "scene" each agent role can play. We pick one line per tick and
// substitute role-appropriate phrasing so the feed reads like a real team.
const SCENES_BY_ROLE = {
  planner: [
    { delay: 600,  line: 'THOUGHT: Breaking the request into 4 subtasks.' },
    { delay: 700,  line: 'TOOL: read_file path=README.md' },
    { delay: 600,  line: 'RESULT: Found project conventions section' },
    { delay: 700,  line: 'TOKENS: prompt=1820 completion=410 total=2230' },
  ],
  coder: [
    { delay: 600,  line: 'THOUGHT: Implementing the new validator function.' },
    { delay: 700,  line: 'TOOL: bash $ npm test -- --run validator' },
    { delay: 1200, line: 'ERROR: 1 test failed: "rejects negative quantities"' },
    { delay: 700,  line: 'TOOL: edit_file path=src/validator.js' },
    { delay: 600,  line: 'RESULT: Patched 3 lines around the guard clause' },
    { delay: 700,  line: 'TOKENS: prompt=2410 completion=680 total=3090' },
  ],
  reviewer: [
    { delay: 700,  line: 'THOUGHT: Inspecting the diff for missing edge cases.' },
    { delay: 600,  line: 'TOOL: bash $ git diff --stat' },
    { delay: 600,  line: 'RESULT: 2 files changed, 41 insertions(+), 6 deletions(-)' },
    { delay: 700,  line: 'TOKENS: prompt=1320 completion=290 total=1610' },
  ],
  researcher: [
    { delay: 800,  line: 'THOUGHT: Looking up Parquet partitioning best practices.' },
    { delay: 700,  line: 'TOOL: web_search query="parquet partitioning small files"' },
    { delay: 900,  line: 'RESULT: 7 sources cited' },
    { delay: 700,  line: 'TOKENS: prompt=3010 completion=540 total=3550' },
  ],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Push a stream of lines from one agent through the parser. Each agent
// keeps emitting forever so freshly-connected dashboards always see action.
const startAgent = ({ project, agent, onEvent }) => {
  const stream = new Readable({ read() {} });
  attachLineParser(stream, {
    source: 'stdout',
    onEvent,
    context: {
      projectId: project.projectId,
      projectName: project.projectName,
      projectPath: project.projectPath,
      agentName: agent.agentName,
      agentRole: agent.agentRole,
      model: agent.model,
    },
  });

  const scene = SCENES_BY_ROLE[agent.agentRole] || SCENES_BY_ROLE.coder;
  let i = 0;

  const tick = () => {
    const step = scene[i % scene.length];
    stream.push(`${step.line}\n`);
    i += 1;
    // Slight jitter so the agents don't all tick on the same beat.
    const jitter = Math.floor(Math.random() * 400);
    setTimeout(tick, step.delay + jitter);
  };

  // Stagger each agent's first tick so the feed doesn't burst at t=0.
  setTimeout(tick, 300 + Math.floor(Math.random() * 1500));
};

export const startDummyStream = (onEvent) => {
  console.log(
    `[dummy] starting ${PROJECTS.length} projects, ` +
    `${PROJECTS.reduce((n, p) => n + p.agents.length, 0)} agents total`,
  );
  for (const project of PROJECTS) {
    for (const agent of project.agents) {
      startAgent({ project, agent, onEvent });
    }
  }
};
