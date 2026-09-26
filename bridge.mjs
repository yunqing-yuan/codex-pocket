import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  chmodSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { MAX_FILE_BYTES, saveUpload, messageInput, resolveUploads } from "./bridge/uploads.mjs";
import { DesktopIpc } from './bridge/desktop-ipc.mjs';
import { listArtifacts, readArtifact } from './bridge/artifacts.mjs';
import {
  approvalDecision,
  mapItems,
  normalizeThread,
  normalizeTimestamp,
  parseLimit,
  tokenMatches,
} from "./bridge/core.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.POCKET_BRIDGE_PORT || 15731);
const host = process.env.POCKET_BRIDGE_HOST || "0.0.0.0";
const runtimeDir = resolve(
  process.env.POCKET_BRIDGE_RUNTIME_DIR || join(ROOT, "runtime"),
);
const pairingPath = join(runtimeDir, "pairing.json");
const maxBodyBytes = 1_000_000;

function loadToken() {
  if (process.env.POCKET_BRIDGE_TOKEN) return process.env.POCKET_BRIDGE_TOKEN;
  try {
    const parsed = JSON.parse(readFileSync(pairingPath, "utf8"));
    if (typeof parsed.token === "string" && parsed.token.length >= 16)
      return parsed.token;
  } catch {}
  const token = randomBytes(24).toString("base64url");
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    pairingPath,
    JSON.stringify(
      { token, createdAt: new Date().toISOString(), port },
      null,
      2,
    ),
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    chmodSync(pairingPath, 0o600);
  } catch {}
  return token;
}

function findCodexExecutable() {
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  if (process.platform !== "win32") return "codex";
  const candidates = [];
  const appData = process.env.LOCALAPPDATA;
  if (appData) {
    const root = join(appData, "OpenAI", "Codex", "bin");
    try {
      for (const version of readdirSync(root)) {
        const candidate = join(root, version, "codex.exe");
        if (existsSync(candidate))
          candidates.push({
            path: candidate,
            mtime: statSync(candidate).mtimeMs,
          });
      }
    } catch {}
  }
  try {
    const found = execFileSync("where.exe", ["codex.exe"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)[0];
    if (found) candidates.push({ path: found, mtime: Number.MAX_SAFE_INTEGER });
  } catch {}
  if (candidates.length)
    return candidates.sort((a, b) => b.mtime - a.mtime)[0].path;
  throw new Error(
    "找不到 codex.exe。请设置 CODEX_BIN 为 Codex 可执行文件的绝对路径。",
  );
}

class CodexBridge extends EventEmitter {
  constructor(executable) {
    super();
    this.executable = executable;
    this.child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      cwd: ROOT,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.nextId = 1;
    this.pending = new Map();
    this.approvals = new Map();
    this.ownedThreads = new Set();
    this.activeTurns = new Map();
    this.execution = new Map();
    this.releaseTimers = new Map();
    this.buffer = "";
    this.initialized = null;
    this.closed = false;
    this.operations = new Map();
    this.threadOperations = new Map();
    this.capabilityCache = null;
    this.desktop = new DesktopIpc();
    this.desktop.on('state', (id, state) => this.updateDesktopState(id, state));
    this.desktop.on('disconnected', () => {
      for (const [key, value] of this.approvals) if (value.desktop) this.approvals.delete(key);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));
    this.child.stderr.on("data", (chunk) =>
      process.stderr.write(`[codex] ${chunk}`),
    );
    this.child.on("error", (error) => {
      this.fail(error);
      this.emit("event", "bridge.closed", { message: error.message });
    });
    this.child.on("exit", (code, signal) => {
      this.fail(
        new Error(`Codex app-server exited (${code ?? signal ?? "unknown"})`),
      );
      this.emit("event", "bridge.closed", { code, signal });
    });
  }

  fail(error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
    this.initialized = null;
    this.emit("event", "bridge.error", { message: error.message });
  }

  consume(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.emit("event", "bridge.protocolError", {
          message: "invalid JSON from app-server",
        });
        continue;
      }
      if (
        !message.method &&
        message.id !== undefined &&
        this.pending.has(message.id)
      ) {
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error)
          request.reject(new Error(message.error.message || "Codex RPC error"));
        else request.resolve(message.result);
        continue;
      }
      this.handleServerMessage(message);
    }
  }

  handleServerMessage(message) {
    const p = message.params || {}, id = String(p.threadId || p.thread?.id || '');
    if (message.method?.endsWith("requestApproval")) {
      const params = message.params || {};
      const key = String(params.approvalId || params.itemId || message.id);
      const entry = {
        key,
        rpcId: message.id,
        method: message.method,
        params,
        createdAt: Date.now(),
      };
      this.approvals.set(key, entry);
      this.emit("approval", this.publicApproval(entry));
    }
    if (message.method === "turn/started") {
      const params = message.params || {};
      const threadId = params.threadId || params.thread?.id;
      if (threadId)
        this.activeTurns.set(
          String(threadId),
          params.turnId || params.turn?.id || null,
        );
      if (threadId) this.execution.set(String(threadId), {
        phase: 'waiting', startedAt: normalizeTimestamp(params.turn?.startedAt), updatedAt: Date.now(),
      });
    }
    const progress = this.execution.get(id);
    if (progress && this.activeTurns.has(id)) {
      let phase;
      if (message.method === 'error' && p.willRetry) phase = 'retrying';
      else if (message.method?.endsWith('requestApproval')) phase = 'approval';
      else if (message.method === 'item/agentMessage/delta') phase = 'generating';
      else if (message.method?.startsWith('item/reasoning/')) phase = 'processing';
      else if (message.method === 'item/started') {
        phase = ['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(p.item?.type) ? 'tools'
          : p.item?.type === 'reasoning' ? 'processing' : p.item?.type === 'agentMessage' ? 'generating' : null;
      } else if (message.method === 'item/completed' && p.item?.type !== 'userMessage') phase = 'waiting';
      if (phase && progress.phase !== 'stopping') {
        progress.phase = phase; progress.updatedAt = Date.now();
      }
    }
    if (message.method === "turn/completed") {
      const threadId = message.params?.threadId;
      if (threadId) {
        this.activeTurns.delete(String(threadId));
        this.execution.delete(String(threadId));
        for (const [key, entry] of this.approvals)
          if (entry.params.threadId === threadId) this.approvals.delete(key);
        if (this.ownedThreads.has(threadId)) this.scheduleRelease(threadId);
      }
    }
    if (message.method === 'thread/closed' && id) {
      this.activeTurns.delete(id); this.execution.delete(id); this.ownedThreads.delete(id);
      for (const [key, entry] of this.approvals) if (entry.params.threadId === id) this.approvals.delete(key);
      clearTimeout(this.releaseTimers.get(id)); this.releaseTimers.delete(id);
    }
    if (message.method)
      this.emit("event", message.method, message.params || {});
  }

  publicApproval(entry) {
    const p = entry.params || {};
    const permissions = p.permissions || null;
    return {
      id: entry.key,
      type: entry.method,
      title:
        entry.method === "item/permissions/requestApproval"
          ? "申请额外权限"
          : entry.method === "item/fileChange/requestApproval"
            ? "修改文件"
            : "执行命令",
      threadId: p.threadId ?? null,
      turnId: p.turnId ?? null,
      itemId: p.itemId ?? null,
      approvalId: p.approvalId ?? null,
      command:
        p.command ??
        (permissions ? JSON.stringify(permissions, null, 2) : null),
      cwd: p.cwd ?? null,
      reason: p.reason ?? null,
      kind: p.kind ?? null,
      availableDecisions: p.availableDecisions ?? null,
      startedAtMs: normalizeTimestamp(p.startedAtMs),
      status: "pending",
    };
  }

  updateDesktopState(id, state) {
    const current = new Set();
    for (const request of state?.requests || []) {
      if (!['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(request.method)) continue;
      const key = `desktop:${id}:${request.id}`;
      current.add(key);
      const entry = { key, rpcId: request.id, method: request.method, params: { ...request.params, threadId: id }, desktop: true, createdAt: Date.now() };
      const fresh = !this.approvals.has(key);
      this.approvals.set(key, entry);
      if (fresh) this.emit('approval', this.publicApproval(entry));
    }
    for (const [key, entry] of this.approvals) if (entry.desktop && entry.params.threadId === id && !current.has(key)) this.approvals.delete(key);
    this.emit('event', 'desktop.thread.updated', { threadId: id });
  }

  async releaseThread(id) {
    if (!this.ownedThreads.has(id) || this.activeTurns.has(id)) return;
    await this.rpc('thread/unsubscribe', { threadId: id });
    this.ownedThreads.delete(id);
    clearTimeout(this.releaseTimers.get(id)); this.releaseTimers.delete(id);
  }

  scheduleRelease(id, delay = 0) {
    if (this.closed || !this.ownedThreads.has(id) || this.activeTurns.has(id) || this.releaseTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.releaseTimers.delete(id);
      this.withThread(id, () => this.releaseThread(id)).catch(() => {
        this.emit('event', 'thread.release.retrying', { threadId: id });
        this.scheduleRelease(id, 3000);
      });
    }, delay);
    timer.unref(); this.releaseTimers.set(id, timer);
  }

  async ensureInitialized() {
    if (this.initialized) return this.initialized;
    this.initialized = this.rpc("initialize", {
      clientInfo: { name: "codex-pocket-bridge", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    })
      .then((result) => {
        this.notify("initialized", {});
        return result;
      })
      .catch((error) => {
        this.initialized = null;
        throw error;
      });
    return this.initialized;
  }

  notify(method, params = {}) {
    if (!this.child?.stdin?.writable)
      throw new Error("Codex app-server stdin is closed");
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  rpc(method, params = {}, timeoutMs = 30_000) {
    const id = this.nextId++;
    return new Promise((resolveRpc, rejectRpc) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRpc(Object.assign(new Error(`等待电脑处理超时：${method}。请先同步消息，避免重复发送。`), { code: 'bridge_request_timeout' }));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolveRpc(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectRpc(error);
        },
      });
      try {
        this.child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        rejectRpc(error);
      }
    });
  }

  respond(id, result) {
    if (id === undefined || id === null)
      throw new Error("approval request has no JSON-RPC id");
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  async health() {
    await this.ensureInitialized();
    await this.rpc("thread/list", { limit: 1, useStateDbOnly: true }, 10_000);
    return {
      ok: true,
      bridge: "codex-pocket",
      transport: "stdio",
      pid: this.child.pid,
      initialized: true,
      executable: basename(this.executable),
      version: '1.3.2',
      sameThreadSending: true,
      backgroundExecution: true,
    };
  }

  async listThreads(query = {}) {
    await this.ensureInitialized();
    const result = await this.rpc("thread/list", {
      limit: parseLimit(query.limit),
      cursor: query.cursor || null,
      searchTerm: query.searchTerm || null,
      cwd: query.cwd ? [query.cwd] : null,
      archived: query.archived === "true" || query.archived === "1",
      sortDirection: query.sortDirection || null,
    });
    const rows = result?.data || result?.threads || [];
    return {
      threads: rows.map((row) => normalizeThread({ ...row,
        ...(this.activeTurns.has(row.id) ? { status: 'active' } : {}),
        archived: query.archived === 'true' || query.archived === '1' }, this.ownedThreads)),
      nextCursor: result?.nextCursor ?? null,
    };
  }

  async readThread(id) {
    await this.ensureInitialized();
    const result = await this.rpc("thread/read", {
      threadId: id,
      includeTurns: false,
    });
    const raw = result?.thread || result || {};
    if (!this.ownedThreads.has(id) && !this.desktop.owners.has(id)) {
      try { await this.desktop.discover(id); } catch {}
    }
    const items = [];
    const turnTimes = new Map();
    const turnErrors = [];
    let latestTurn = null;
    let historyIncomplete = false;
    let turnCursor = null;
    try {
      do {
        const turnsPage = await this.rpc("thread/turns/list", {
          threadId: id,
          cursor: turnCursor,
          limit: 200,
          sortDirection: "asc",
        });
        const turns = Array.isArray(turnsPage?.data)
          ? turnsPage.data
          : turnsPage?.data?.items || turnsPage?.items || [];
        for (const turn of turns) {
          latestTurn = turn;
          if (turn.status === 'failed' && turn.error) turnErrors.push({ id: 'error-' + turn.id, role: 'assistant', text: '本次回复未完成：' + (turn.error.message || '模型返回错误，请重试'), time: normalizeTimestamp(turn.completedAt || turn.startedAt) });
          if (turn.id)
            turnTimes.set(
              String(turn.id),
              normalizeTimestamp(
                turn.startedAt ?? turn.startedAtMs ?? turn.createdAt,
              ),
            );
        }
        turnCursor = turnsPage?.nextCursor ?? null;
        if (!turns.length) break;
      } while (turnCursor);
    } catch {}
    try {
      let cursor = null;
      do {
        const page = await this.rpc("thread/items/list", {
          threadId: id,
          cursor,
          limit: 200,
          sortDirection: "asc",
        });
        const pageItems = Array.isArray(page?.data)
          ? page.data
          : page?.data?.items || page?.items || [];
        items.push(
          ...pageItems.map((entry) =>
            entry?.item
              ? {
                  ...entry.item,
                  turnId: entry.turnId,
                  createdAtMs: turnTimes.get(String(entry.turnId)),
                }
              : entry,
          ),
        );
        cursor = page?.nextCursor ?? null;
        if (!pageItems.length) break;
      } while (cursor);
    } catch (error) {
      // Some Codex builds reject item pagination for a newly-created empty thread.
      historyIncomplete = true;
      // Keep the thread usable and use embedded turns when the server supplied them.
      const embedded = (raw.turns || []).flatMap((turn) => turn.items || turn.item || []);
      if (Array.isArray(embedded)) items.push(...embedded);
      this.emit("event", "thread.items.unavailable", { threadId: id, message: error.message });
    }
    const mapped = mapItems(items);
    const thread = normalizeThread(
      {
        ...raw,
        id,
        messages: [...mapped.messages, ...turnErrors].sort((a, b) => a.time - b.time),
        status: this.activeTurns.has(id) ? { type: "active" } : raw.status || 'idle',
      },
      this.ownedThreads,
    );
    const live = !this.ownedThreads.has(id) && this.desktop.owners.has(id) ? await this.desktop.waitState(id) : null;
    if (live) {
      thread.model = live.latestModel || thread.model;
      thread.reasoningEffort = live.latestThreadSettings?.effort ?? live.latestReasoningEffort ?? live.latestCollaborationMode?.settings?.reasoning_effort ?? thread.reasoningEffort;
      thread.status = live.threadRuntimeStatus?.type || thread.status;
      thread.title = live.title || thread.title;
      thread.owner = 'desktop';
    }
    const terminal = latestTurn && ['completed', 'failed', 'interrupted'].includes(latestTurn.status);
    // Recover a missed completion notification only when persisted state names the same turn.
    if (terminal && this.activeTurns.get(id) === latestTurn.id) {
      this.activeTurns.delete(id); this.execution.delete(id); this.scheduleRelease(id);
      thread.status = 'idle';
    }
    const execution = this.execution.get(id) || (latestTurn?.status === 'inProgress'
      ? { phase: 'running', startedAt: normalizeTimestamp(latestTurn.startedAt), updatedAt: Date.now() } : null);
    if (this.activeTurns.has(id)) { thread.owner = 'bridge'; thread.status = 'active'; }
    return { ...thread, execution: execution ? { ...execution, elapsedMs: Math.max(0, Date.now() - execution.startedAt) } : null,
      releasing: this.ownedThreads.has(id) && !this.activeTurns.has(id) && Boolean(terminal),
      historyIncomplete, tools: mapped.tools };
  }

  async capabilities() {
    await this.ensureInitialized();
    if (this.capabilityCache && Date.now() - this.capabilityCache.at < 15_000) return this.capabilityCache.value;
    const paged = async method => {
      const rows = []; let cursor = null;
      do { const page = await this.rpc(method, { limit: 100, cursor }); rows.push(...(page.data || [])); cursor = page.nextCursor; } while (cursor && rows.length < 1000);
      return rows;
    };
    const [modelsResult, projectsResult, configResult] = await Promise.allSettled([
      paged('model/list'), paged('project/list'), this.rpc('config/read', { includeLayers: false }),
    ]);
    if (modelsResult.status === 'rejected') throw modelsResult.reason;
    const models = modelsResult.value.filter(m => !m.hidden).map(m => ({
      id: m.model, name: m.displayName || m.model,
      efforts: (m.supportedReasoningEfforts || []).map(e => e.reasoningEffort),
      defaultEffort: m.defaultReasoningEffort, inputModalities: m.inputModalities || [], isDefault: m.isDefault,
    }));
    let projects = projectsResult.status === 'fulfilled' ? projectsResult.value.map(p => ({ id: p.id, name: p.name, paths: (p.roots || []).map(r => r.path) })) : [];
    if (projectsResult.status === 'rejected') {
      try {
        const global = JSON.parse(readFileSync(join(process.env.CODEX_HOME || join(homedir(), '.codex'), '.codex-global-state.json'), 'utf8'));
        projects = Object.values(global['local-projects'] || {}).map(p => ({ id: null, name: p.name, paths: p.rootPaths || [] }));
      } catch {}
    }
    const config = configResult.status === 'fulfilled' ? configResult.value.config || {} : {};
    const model = config.model || models.find(m => m.isDefault)?.id || models[0]?.id;
    const value = { models, projects, defaults: { model, effort: config.model_reasoning_effort || models.find(m => m.id === model)?.defaultEffort }, maxFileBytes: MAX_FILE_BYTES, maxAttachments: 6, sameThreadSending: true };
    this.capabilityCache = { at: Date.now(), value };
    return value;
  }

  async modelOptions(options = {}, thread = null) {
    const capabilities = await this.capabilities();
    const model = options.model || thread?.model || capabilities.defaults.model;
    const catalog = capabilities.models.find(m => m.id === model);
    if (options.model && !catalog && options.model !== thread?.model) throw Object.assign(new Error('模型列表已变化，请刷新模型设置'), { statusCode: 400 });
    const effort = options.effort || (model === thread?.model ? thread?.reasoningEffort : null) || (model === capabilities.defaults.model ? capabilities.defaults.effort : null) || catalog?.defaultEffort;
    if (effort && catalog?.efforts.length && !catalog.efforts.includes(effort)) throw Object.assign(new Error('该模型不支持此推理强度，请重新选择'), { statusCode: 400 });
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  }

  once(key, operation) {
    if (!key || typeof key !== 'string' || key.length > 160) return operation();
    if (this.operations.has(key)) return this.operations.get(key);
    const promise = operation().catch(error => {
      // An IPC timeout may arrive after the desktop accepted the message. Keep
      // the same request outcome cached instead of silently sending it twice.
      if (!['desktop_request_timeout', 'desktop_connection_lost', 'bridge_request_timeout'].includes(error.code)) this.operations.delete(key);
      throw error;
    });
    this.operations.set(key, promise);
    if (this.operations.size > 1000) this.operations.delete(this.operations.keys().next().value);
    return promise;
  }

  async startThread(options = {}) {
    await this.ensureInitialized();
    const { model, effort } = await this.modelOptions(options);
    const capabilities = await this.capabilities();
    let cwd;
    let projectId;
    if (options.cwd || options.projectId) {
      const project = capabilities.projects.find(p => (!options.projectId || p.id === options.projectId) && (!options.cwd || p.paths.includes(options.cwd)));
      if (!project) throw Object.assign(new Error('项目已变化，请重新选择目录'), { statusCode: 400 });
      cwd = options.cwd || project.paths[0]; projectId = project.id;
      if (!cwd || !existsSync(cwd)) throw Object.assign(new Error('电脑上的项目目录不可用'), { statusCode: 400 });
    } else {
      cwd = join(runtimeDir, 'workspaces', randomBytes(8).toString('hex'));
      mkdirSync(cwd, { recursive: true });
    }
    const result = await this.rpc("thread/start", {
      cwd, ...(projectId ? { projectId } : {}), model,
      ...(effort ? { config: { model_reasoning_effort: effort } } : {}),
      ephemeral: false,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    const raw = result?.thread || result || {};
    const id = String(raw.id || result?.threadId || "");
    if (!id) throw new Error("Codex did not return a thread id");
    this.ownedThreads.add(id);
    if (typeof options.title === 'string' && options.title.trim()) {
      const name = options.title.trim().replace(/\s+/g, ' ').slice(0, 48);
      try { await this.rpc('thread/name/set', { threadId: id, name }); raw.name = name; } catch {}
    }
    // Codex defers the rollout until the first real user message. Keep the
    // empty thread loaded; unsubscribing here destroys its only live writer.
    return normalizeThread({ ...raw, id, model: result.model || model, reasoningEffort: result.reasoningEffort || effort, status: "idle", messages: [] }, this.ownedThreads);
  }

  withThread(id, operation) {
    const previous = this.threadOperations.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.threadOperations.set(id, next);
    const clean = () => { if (this.threadOperations.get(id) === next) this.threadOperations.delete(id); };
    next.then(clean, clean);
    return next;
  }

  sendMessage(id, text, options = {}) {
    return this.withThread(id, () => this.sendToThread(id, text, options));
  }

  async sendToThread(id, text, options) {
    await this.ensureInitialized();
    const raw = (await this.rpc('thread/read', { threadId: id, includeTurns: false })).thread;
    const thread = normalizeThread(raw, this.ownedThreads);
    if (this.activeTurns.has(id)) throw Object.assign(new Error('这条对话正在生成，请等待完成或先停止任务'), { statusCode: 409, code: 'thread_active' });
    // Discover an existing owner without opening or focusing a desktop window.
    const owner = this.ownedThreads.has(id) ? null : await this.desktop.discover(id).catch(() => null);
    const live = owner ? await this.desktop.waitState(id) : null;
    if (live) {
      thread.model = live.latestModel || thread.model;
      thread.reasoningEffort = live.latestThreadSettings?.effort ?? live.latestReasoningEffort ?? live.latestCollaborationMode?.settings?.reasoning_effort ?? thread.reasoningEffort;
    }
    const modelOptions = await this.modelOptions(options, thread);
    const files = resolveUploads(runtimeDir, options.attachments || []);
    const catalog = (await this.capabilities()).models.find(m => m.id === modelOptions.model);
    if (files.some(f => f.image) && catalog && !catalog.inputModalities.includes('image')) throw Object.assign(new Error('当前模型不支持图片，请切换支持图片的模型'), { statusCode: 400 });
    const input = messageInput(runtimeDir, text, options.attachments || []);
    if (owner) {
      const result = await this.desktop.send(id, input, { ...(options.model || options.effort ? modelOptions : {}), requestId: options.requestId }, owner);
      return { accepted: true, turnId: result?.result?.turn?.id || null, threadId: id, transport: 'desktop' };
    }
    if (!this.ownedThreads.has(id)) {
      if (raw?.path && !existsSync(raw.path)) throw Object.assign(new Error('这条旧会话的记录文件不存在。请新建对话后重新发送；当前草稿和附件已保留。'), { statusCode: 409, code: 'thread_storage_missing' });
      try {
        await this.rpc('thread/resume', { threadId: id, excludeTurns: true });
      } catch (error) {
        if (/active writer|already.*loaded|already.*running/i.test(error.message)) {
          const retryOwner = await this.desktop.discover(id).catch(() => null);
          if (retryOwner) {
            const result = await this.desktop.send(id, input, { ...modelOptions, requestId: options.requestId }, retryOwner);
            return { accepted: true, turnId: result?.result?.turn?.id || null, threadId: id, transport: 'desktop' };
          }
          throw Object.assign(new Error('该会话正由另一进程处理，请等它结束后重试。不会自动弹出电脑窗口。'), { statusCode: 409, code: 'thread_active' });
        }
        throw error;
      }
      this.ownedThreads.add(id);
      this.desktop.forget(id);
    }
    this.activeTurns.set(id, 'pending');
    this.execution.set(id, { phase: 'starting', startedAt: Date.now(), updatedAt: Date.now() });
    try {
      const result = await this.rpc('turn/start', { threadId: id, input, ...modelOptions, ...(options.requestId ? { clientUserMessageId: options.requestId } : {}) });
      if (this.activeTurns.get(id) === 'pending') this.activeTurns.set(id, result?.turn?.id || 'pending');
      return { accepted: true, turnId: result?.turn?.id || null, threadId: id, transport: 'bridge' };
    } catch (error) {
      if (error.code !== 'bridge_request_timeout') {
        this.activeTurns.delete(id); this.execution.delete(id);
        // A new empty thread has no persisted rollout yet; keep its writer for retry.
        if (raw?.path && existsSync(raw.path)) this.scheduleRelease(id);
      }
      throw error;
    }
  }

  archiveThread(id, archived) {
    return this.withThread(id, async () => {
      const thread = await this.readThread(id);
      if (this.activeTurns.has(id) || ['active', 'inProgress', 'running', 'busy'].includes(thread.status) || [...this.approvals.values()].some(a => a.params.threadId === id)) {
        throw Object.assign(new Error('请先完成或停止任务、处理待审批操作，再归档会话'), { statusCode: 409 });
      }
      await this.releaseThread(id);
      await this.rpc(archived ? 'thread/archive' : 'thread/unarchive', { threadId: id });
      await this.desktop.notifyArchived(id, archived);
      this.desktop.forget(id);
      return { ok: true, archived };
    });
  }

  async interrupt(id) {
    await this.ensureInitialized();
    const turnId = this.activeTurns.get(id);
    if (!turnId) {
      return this.desktop.call(id, 'thread-follower-interrupt-turn', { mode: 'user-stop', expectedTurnId: null });
    }
    if (turnId === 'pending') throw Object.assign(new Error('任务仍在确认中，请稍后同步再停止'), { statusCode: 409 });
    const progress = this.execution.get(id);
    if (progress) { progress.phase = 'stopping'; progress.updatedAt = Date.now(); }
    let result;
    try { result = await this.rpc("turn/interrupt", { threadId: id, turnId }); }
    catch (error) { if (progress && this.activeTurns.has(id)) progress.phase = 'running'; throw error; }
    return {
      ok: true,
      ...result,
    };
  }

  async respondApproval(key, decision) {
    const mapped = approvalDecision(decision);
    if (!mapped) {
      const error = new Error(
        "decision must be approved_once, approved_always, or rejected",
      );
      error.statusCode = 400;
      error.code = "invalid_decision";
      throw error;
    }
    const entry = this.approvals.get(String(key));
    if (!entry) {
      const error = new Error("approval not found or expired");
      error.statusCode = 404;
      error.code = "approval_not_found";
      throw error;
    }
    const result =
      entry.method === "item/permissions/requestApproval"
        ? {
            permissions:
              decision === "rejected" ? {} : entry.params.permissions || {},
            scope: decision === "approved_always" ? "session" : "turn",
          }
        : { decision: mapped };
    if (entry.desktop) {
      const method = entry.method === 'item/permissions/requestApproval' ? 'thread-follower-permissions-request-approval-response' : entry.method === 'item/fileChange/requestApproval' ? 'thread-follower-file-approval-decision' : 'thread-follower-command-approval-decision';
      await this.desktop.call(entry.params.threadId, method, { requestId: String(entry.rpcId), ...(entry.method === 'item/permissions/requestApproval' ? { response: result } : { decision: mapped }) });
    } else this.respond(entry.rpcId, result);
    this.approvals.delete(String(key));
    this.emit("event", "approval.responded", { id: String(key), decision });
    return { ok: true, id: String(key), decision };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.releaseTimers.values()) clearTimeout(timer);
    this.releaseTimers.clear();
    this.desktop.close();
    for (const entry of this.approvals.values()) {
      try {
        if (!entry.desktop) this.respond(entry.rpcId, { decision: "decline" });
      } catch {}
    }
    this.approvals.clear();
    try {
      this.child.kill();
    } catch {}
  }
}

function readJsonBody(req, limit = maxBodyBytes) {
  return new Promise((resolveBody, rejectBody) => {
    let raw = "";
    let tooLarge = false;
    let bytes = 0;
    req.setEncoding('utf8');
    req.on("data", (chunk) => {
      if (!tooLarge) {
        raw += chunk;
        bytes += Buffer.byteLength(chunk);
        if (bytes > limit) { tooLarge = true; raw = ''; }
      }
    });
    req.on("end", () => {
      if (tooLarge)
        return rejectBody(
          Object.assign(new Error("文件或消息过大"), { statusCode: 413 }),
        );
      if (!raw.trim()) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        rejectBody(
          Object.assign(new Error("invalid JSON"), { statusCode: 400 }),
        );
      }
    });
    req.on("error", rejectBody);
    req.on('aborted', () => rejectBody(new Error('上传已中断')));
  });
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = (process.env.POCKET_BRIDGE_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const headers = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Project",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && (!allowed.length || allowed.includes(origin)))
    headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function send(res, req, code, payload) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(payload));
}
function authorized(req, token) {
  const value = req.headers.authorization || "";
  return value.startsWith("Bearer ") && tokenMatches(token, value.slice(7));
}
function publicError(error) {
  return { error: error.code || "bridge_error", message: error.message };
}

export function createBridgeServer({
  bridge,
  token = loadToken(),
  listenHost = host,
  listenPort = port,
  publicHandler = null,
} = {}) {
  const activeBridge = bridge || new CodexBridge(findCodexExecutable());
  const clients = new Set();
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 20_000);
  activeBridge.on("event", (type, payload) => {
    const packet = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(packet);
  });
  activeBridge.on("approval", (approval) => {
    const packet = `event: approval\ndata: ${JSON.stringify(approval)}\n\n`;
    for (const client of clients) client.write(packet);
  });
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (publicHandler && (await publicHandler(req, res, corsHeaders(req))))
      return;
    if (!authorized(req, token)) {
      send(res, req, 401, {
        error: "unauthorized",
        message: "Bearer token required",
      });
      return;
    }
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const parts = url.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
    const route = parts[0] === "v1" ? parts.slice(1) : parts;
    try {
      if (req.method === 'GET' && route[0] === 'capabilities' && route.length === 1) {
        send(res, req, 200, await activeBridge.capabilities()); return;
      }
      if (req.method === 'POST' && route[0] === 'uploads' && route.length === 1) {
        send(res, req, 201, saveUpload(runtimeDir, await readJsonBody(req, Math.ceil(MAX_FILE_BYTES * 4 / 3) + 4096))); return;
      }
      if (req.method === "GET" && url.pathname === "/health") {
        send(res, req, 200, await activeBridge.health());
        return;
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/v1/events" || url.pathname === "/events")
      ) {
        await activeBridge.ensureInitialized();
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...corsHeaders(req),
        });
        res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (route[0] === "threads" || route[0] === "approvals")
        await activeBridge.ensureInitialized();
      if (
        req.method === "GET" &&
        route.length === 1 &&
        route[0] === "threads"
      ) {
        send(
          res,
          req,
          200,
          await activeBridge.listThreads(Object.fromEntries(url.searchParams)),
        );
        return;
      }
      if (
        req.method === "GET" &&
        route.length === 1 &&
        route[0] === "approvals"
      ) {
        send(res, req, 200, {
          approvals: [...activeBridge.approvals.values()].map((entry) =>
            activeBridge.publicApproval(entry),
          ),
        });
        return;
      }
      if (
        req.method === "GET" &&
        route[0] === "threads" &&
        route.length === 2
      ) {
        send(res, req, 200, await activeBridge.readThread(route[1]));
        return;
      }
      if (route[0] === 'threads' && route[1] && route.length === 3 && route[2] === 'archive' && req.method === 'POST') {
        const payload = await readJsonBody(req);
        if (typeof payload.archived !== 'boolean') throw Object.assign(new Error('archived must be boolean'), { statusCode: 400 });
        send(res, req, 200, await activeBridge.archiveThread(route[1], payload.archived)); return;
      }
      if (route[0] === 'threads' && route[1] && route.length === 3 && route[2] === 'artifacts' && req.method === 'GET') {
        send(res, req, 200, { artifacts: await listArtifacts(await activeBridge.readThread(route[1])) }); return;
      }
      if (route[0] === 'threads' && route[1] && route.length === 4 && route[2] === 'artifacts' && req.method === 'GET') {
        send(res, req, 200, await readArtifact(await activeBridge.readThread(route[1]), route[3])); return;
      }
      if (
        req.method === "POST" &&
        route.length === 1 &&
        route[0] === "threads"
      ) {
        const payload = await readJsonBody(req);
        send(
          res,
          req,
          201,
          await activeBridge.once(payload.requestId ? 'create:' + payload.requestId : null, () => activeBridge.startThread(payload)),
        );
        return;
      }
      if (
        req.method === "POST" &&
        route[0] === "threads" &&
        route[1] &&
        route[2] === "messages"
      ) {
        const payload = await readJsonBody(req);
        const text =
          typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text && !payload.attachments?.length)
          throw Object.assign(new Error("text is required"), {
            statusCode: 400,
            code: "text_required",
          });
        send(
          res,
          req,
          200,
          await activeBridge.once(payload.requestId ? 'send:' + route[1] + ':' + payload.requestId : null, () => activeBridge.sendMessage(route[1], text, payload)),
        );
        return;
      }
      if (
        req.method === "POST" &&
        route[0] === "threads" &&
        route[1] &&
        route[2] === "interrupt"
      ) {
        send(res, req, 200, await activeBridge.interrupt(route[1]));
        return;
      }
      if (req.method === "POST" && route[0] === "approvals" && route[1]) {
        const payload = await readJsonBody(req);
        send(
          res,
          req,
          200,
          await activeBridge.respondApproval(route[1], payload.decision),
        );
        return;
      }
      send(res, req, 404, { error: "not_found", message: "Route not found" });
    } catch (error) {
      send(res, req, error.statusCode || 502, publicError(error));
    }
  });
  server.on("close", () => clearInterval(heartbeat));
  server.listen(listenPort, listenHost);
  return { server, bridge: activeBridge, token, port: listenPort };
}

const invoked =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  let running;
  try {
    running = createBridgeServer();
    console.log(`Codex Pocket bridge listening on http://${host}:${port}`);
    console.log(`Pairing token saved to ${pairingPath} (not printed)`);
    console.log(`Codex app-server: ${basename(running.bridge.executable)}`);
  } catch (error) {
    console.error(`[bridge] ${error.message}`);
    process.exitCode = 1;
  }
  const shutdown = () => {
    if (running) {
      running.bridge.close();
      running.server.close();
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { CodexBridge, findCodexExecutable, loadToken, pairingPath };
