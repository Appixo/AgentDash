// Agent runner.
//
// Spawns an external CLI as a child process and streams its stdout/stderr
// through the line parser. Each event is tagged with the project + agent
// context so the multi-tenant UI can attribute it correctly.
//
// Lifecycle concerns handled here:
//   - stdin is closed so the CLI can't block waiting for input.
//   - stdout AND stderr are both parsed; stderr lines are tagged accordingly.
//   - On `exit` we surface the code and reason as a system event.
//   - On Node shutdown (SIGINT/SIGTERM) we forward the signal to the child
//     and escalate to SIGKILL after a short grace period to avoid orphans.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { attachLineParser } from './parser.js';

const KILL_GRACE_MS = 3000;

const systemEvent = (project, level, message) => ({
  id: randomUUID(),
  type: level === 'error' ? 'error' : 'system',
  message,
  timestamp: new Date().toISOString(),
  projectId: project?.projectId,
  projectName: project?.projectName,
  projectPath: project?.projectPath,
  agentName: project?.agentName,
  agentRole: project?.agentRole,
  model: project?.model,
});

export const startAgentProcess = ({ project, onEvent }) => {
  const cmd = project.cmd;
  const args = project.args || [];
  const cwd = project.projectPath || process.cwd();

  console.log(`[spawn] ${project.projectName}: ${cmd} ${args.join(' ')} (cwd=${cwd})`);

  let child;
  try {
    child = spawn(cmd, args, {
      cwd,
      env: { ...process.env, ...(project.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // let Windows resolve .cmd / .bat
    });
  } catch (err) {
    onEvent(systemEvent(project, 'error', `Failed to spawn ${cmd}: ${err.message}`));
    return null;
  }

  onEvent(systemEvent(project, 'info', `Started: ${cmd} ${args.join(' ')} (pid=${child.pid})`));

  const context = {
    projectId: project.projectId,
    projectName: project.projectName,
    projectPath: project.projectPath,
    agentName: project.agentName,
    agentRole: project.agentRole,
    model: project.model,
  };

  attachLineParser(child.stdout, { source: 'stdout', onEvent, context });
  attachLineParser(child.stderr, { source: 'stderr', onEvent, context });

  child.on('error', (err) => {
    onEvent(systemEvent(project, 'error', `Process error: ${err.message}`));
  });

  child.on('exit', (code, signal) => {
    onEvent(systemEvent(
      project,
      code === 0 ? 'info' : 'error',
      `Process exited (code=${code}, signal=${signal ?? 'none'})`,
    ));
  });

  const forward = (signal) => {
    if (child.exitCode !== null) return;
    try { child.kill(signal); } catch { /* already dead */ }
    setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* noop */ }
      }
    }, KILL_GRACE_MS).unref();
  };

  process.once('SIGINT', () => forward('SIGINT'));
  process.once('SIGTERM', () => forward('SIGTERM'));

  return child;
};
