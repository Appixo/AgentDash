// Stream parser.
//
// AI CLIs emit free-form text on stdout/stderr. The parser converts each line
// into a structured event the dashboard can render. Every event carries
// project + agent + model metadata so the multi-tenant UI can attribute it.
//
// Token events additionally carry a parsed `tokens` object and an estimated
// `costUsd` so the metrics row can chart usage and spend over time.

import { randomUUID } from 'node:crypto';

const PREFIX_RULES = [
  { prefix: 'THOUGHT:', type: 'thought' },
  { prefix: 'TOOL:', type: 'tool_call' },
  { prefix: 'RESULT:', type: 'tool_result' },
  { prefix: 'ERROR:', type: 'error' },
  { prefix: 'TOKENS:', type: 'tokens' },
];

// Rough per-1K-token pricing in USD. Used purely for in-app cost charts;
// not authoritative billing. Update as model pricing changes.
const MODEL_PRICING = {
  'claude-opus-4-7':     { promptPer1k: 0.015,  completionPer1k: 0.075 },
  'claude-sonnet-4-6':   { promptPer1k: 0.003,  completionPer1k: 0.015 },
  'claude-haiku-4-5':    { promptPer1k: 0.0008, completionPer1k: 0.004 },
  'gpt-4':               { promptPer1k: 0.03,   completionPer1k: 0.06  },
  'gpt-4o':              { promptPer1k: 0.005,  completionPer1k: 0.015 },
};

// Parse "prompt=1240 completion=312 total=1552" → { prompt, completion, total }.
const parseTokenPayload = (payload) => {
  const out = {};
  for (const part of payload.split(/\s+/)) {
    const [k, v] = part.split('=');
    const n = Number(v);
    if (k && Number.isFinite(n)) out[k] = n;
  }
  if (out.total == null && (out.prompt != null || out.completion != null)) {
    out.total = (out.prompt || 0) + (out.completion || 0);
  }
  return out;
};

const estimateCostUsd = (tokens, model) => {
  const price = MODEL_PRICING[model];
  if (!price || !tokens) return 0;
  const prompt = (tokens.prompt || 0) / 1000 * price.promptPer1k;
  const completion = (tokens.completion || 0) / 1000 * price.completionPer1k;
  return Number((prompt + completion).toFixed(6));
};

// Convert a single line of agent output into a structured event.
// `context` carries project + agent identity attached upstream (per child process).
export const parseLine = (rawLine, { source = 'stdout', context = {} } = {}) => {
  const line = rawLine.trim();
  if (!line) return null;

  const base = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    source,
    projectId: context.projectId,
    projectPath: context.projectPath,
    projectName: context.projectName,
    agentName: context.agentName,
    agentRole: context.agentRole,
    model: context.model,
  };

  for (const rule of PREFIX_RULES) {
    if (line.startsWith(rule.prefix)) {
      const payload = line.slice(rule.prefix.length).trim();
      if (rule.type === 'tokens') {
        const tokens = parseTokenPayload(payload);
        return {
          ...base,
          type: 'tokens',
          message: payload,
          tokens,
          costUsd: estimateCostUsd(tokens, base.model),
        };
      }
      return { ...base, type: rule.type, message: payload };
    }
  }

  return {
    ...base,
    type: source === 'stderr' ? 'error' : 'log',
    message: line,
  };
};

// Wrap a Node Readable stream and emit one parsed event per line.
// Buffers partial lines so multi-chunk writes don't get split mid-token.
export const attachLineParser = (stream, { source, onEvent, context = {} }) => {
  let buffer = '';

  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const event = parseLine(line, { source, context });
      if (event) onEvent(event);
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      const event = parseLine(buffer, { source, context });
      if (event) onEvent(event);
      buffer = '';
    }
  });
};
