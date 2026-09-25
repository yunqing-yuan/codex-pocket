import { timingSafeEqual } from 'node:crypto';

export function normalizeTimestamp(value, fallback = Date.now()) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 100_000_000_000 ? Math.round(value) : Math.round(value * 1000);
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return normalizeTimestamp(numeric, fallback);
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function statusName(status) {
  if (typeof status === 'string') return status;
  const type = status?.type;
  return type === 'notLoaded' ? 'inactive' : type === 'systemError' ? 'error' : type || 'unknown';
}

export function textFromInput(input) {
  if (typeof input === 'string') return input;
  if (!input) return '';
  if (Array.isArray(input)) return input.map(textFromInput).filter(Boolean).join('\n');
  if (typeof input.text === 'string') return input.text;
  if (typeof input.content === 'string') return input.content;
  if (input.type === 'text' || input.type === 'input_text') return String(input.text || '');
  return '';
}

export function normalizeThread(raw = {}, owned = new Set()) {
  const id = String(raw.id ?? raw.threadId ?? '');
  const updatedAt = normalizeTimestamp(raw.updatedAtMs ?? raw.updatedAt ?? raw.updated_at ?? raw.createdAtMs ?? raw.createdAt);
  const title = String(raw.title ?? raw.name ?? raw.firstUserMessage ?? 'Untitled thread');
  const status = statusName(raw.status ?? raw.threadStatus);
  return {
    id,
    title,
    status,
    updatedAt,
    summary: String(raw.preview ?? raw.summary ?? raw.firstUserMessage ?? ''),
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    cwd: raw.cwd == null ? null : String(raw.cwd),
    source: raw.source ?? raw.threadSource ?? raw.originator ?? null,
    owner: owned.has(id) ? 'bridge' : 'external',
    model: raw.model ?? null,
    modelProvider: raw.modelProvider ?? raw.model_provider ?? null,
    reasoningEffort: raw.reasoningEffort ?? raw.reasoning_effort ?? null,
    projectId: raw.projectId ?? null,
    forkedFromId: raw.forkedFromId ?? null,
    canAcceptDirectInput: raw.canAcceptDirectInput ?? null,
    archived: Boolean(raw.archived),
  };
}

function commandTool(item) {
  return {
    type: item.type,
    command: item.command ?? null,
    cwd: item.cwd ?? null,
    status: item.status ?? null,
    exitCode: item.exitCode ?? null,
    output: item.aggregatedOutput ?? null,
    changes: item.changes ?? null,
    server: item.server ?? null,
    tool: item.tool ?? null,
  };
}

export function itemToMessage(item = {}) {
  const time = normalizeTimestamp(item.createdAtMs ?? item.createdAt ?? item.timestamp);
  const base = { id: String(item.id ?? `${item.type ?? 'item'}-${time}`), time, rawType: item.type };
  if (item.type === 'userMessage') return { ...base, role: 'user', text: textFromInput(item.content) };
  if (item.type === 'agentMessage') return { ...base, role: 'assistant', text: String(item.text ?? '') };
  if (item.type === 'plan') return { ...base, role: 'assistant', text: String(item.text ?? ''), plan: true };
  if (item.type === 'reasoning') {
    const text = textFromInput(item.summary) || textFromInput(item.content);
    return text ? { ...base, role: 'assistant', text, reasoning: true } : null;
  }
  if (item.type === 'commandExecution' || item.type === 'fileChange' || item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
    const tool = commandTool(item);
    const text = item.type === 'commandExecution'
      ? [item.command, item.aggregatedOutput].filter(Boolean).join('\n')
      : item.type === 'fileChange'
        ? (item.changes || []).map((change) => `${change.kind}: ${change.path}`).join('\n')
        : [item.server, item.tool, item.status].filter(Boolean).join(' · ');
    return { ...base, role: 'tool', text, tool };
  }
  if (item.type === 'contextCompaction' || item.type === 'sleep') return null;
  const text = textFromInput(item.text ?? item.content ?? item.output);
  return text ? { ...base, role: item.type?.includes('Message') ? 'assistant' : 'tool', text, tool: item.type ? { type: item.type } : undefined } : null;
}

export function mapItems(items = []) {
  const messages = [];
  const tools = [];
  for (const item of items) {
    const message = itemToMessage(item);
    if (message) messages.push(message);
    if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(item.type)) tools.push(message?.tool ?? commandTool(item));
  }
  return { messages, tools };
}

export function approvalDecision(value) {
  const mapping = { approved_once: 'accept', approved_always: 'acceptForSession', rejected: 'decline' };
  return mapping[value] ?? null;
}

export function tokenMatches(expected, supplied) {
  if (!expected || typeof supplied !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function parseLimit(value, fallback = 50, max = 200) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
