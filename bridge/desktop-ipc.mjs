import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const versions = {
  initialize: 0, 'thread-owner-discovery': 1,
  'thread-follower-start-turn': 2, 'thread-follower-steer-turn': 1,
  'thread-follower-interrupt-turn': 4,
  'thread-follower-command-approval-decision': 1,
  'thread-follower-file-approval-decision': 1,
  'thread-follower-permissions-request-approval-response': 1,
  'thread-stream-following-changed': 1,
};
const failure = (message, code = 'desktop_unavailable') => Object.assign(new Error(message), { code, statusCode: 409 });

// The desktop's local follower protocol delegates to its existing thread owner.
// No new writer, official-account login, process injection, or desktop files are needed.
export class DesktopIpc extends EventEmitter {
  constructor() {
    super();
    this.socket = null; this.connecting = null; this.clientId = null;
    this.pending = new Map(); this.owners = new Map(); this.states = new Map();
    this.following = new Map(); this.closed = false;
  }
  async connect() {
    if (this.socket && !this.socket.destroyed && this.clientId) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().catch(error => { this.socket?.destroy(); throw error; }).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async open() {
    if (this.closed) throw failure('电脑连接已关闭');
    const path = process.env.POCKET_DESKTOP_PIPE || (process.platform === 'win32' ? '\\\\.\\pipe\\codex-ipc' : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc', 'ipc.sock'));
    const socket = net.connect(path);
    let buffer = Buffer.alloc(0);
    this.socket = socket;
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.clientId = null; this.socket = null; this.owners.clear(); this.states.clear(); this.following.clear();
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(failure('电脑连接中断，消息状态待同步，请勿连续重复发送', 'desktop_connection_lost')); }
      this.pending.clear(); this.emit('disconnected');
    });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (!length || length > 256 * 1024 * 1024) { socket.destroy(); return; }
        if (buffer.length < length + 4) return;
        const frame = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4);
        try { this.receive(JSON.parse(frame.toString('utf8'))); } catch { socket.destroy(); return; }
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(failure('请打开电脑上的 Codex 客户端')); }, 2500);
      socket.once('connect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(failure('请打开电脑上的 Codex 客户端')); });
    });
    const response = await this.requestRaw('initialize', { clientType: 'codex-pocket' }, { timeoutMs: 3000 });
    this.clientId = response.result?.clientId;
    if (!this.clientId) { socket.destroy(); throw failure('桌面连接协议不兼容，请更新电脑桥'); }
  }
  write(message) {
    if (!this.socket || this.socket.destroyed) throw failure('桌面连接不可用');
    const body = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4);
    header.writeUInt32LE(body.length); this.socket.write(Buffer.concat([header, body]));
  }
  requestRaw(method, params, { targetClientId, timeoutMs = 12000 } = {}) {
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(failure('等待电脑确认超时，请先同步消息状态', 'desktop_request_timeout'));
      }, timeoutMs + 1000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.write({ type: 'request', requestId, sourceClientId: this.clientId || 'initializing-client', method, params, targetClientId, version: versions[method] ?? 0, timeoutMs }); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }
  receive(message) {
    if (message.type === 'response') {
      const request = this.pending.get(message.requestId);
      if (request) { clearTimeout(request.timer); this.pending.delete(message.requestId); request.resolve(message); }
    } else if (message.type === 'client-discovery-request') {
      this.write({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
    } else if (message.type === 'broadcast') {
      if (message.targetClientIds && !message.targetClientIds.includes(this.clientId)) return;
      const p = message.params || {};
      if (message.method === 'client-status-changed' && p.status === 'disconnected') {
        for (const [id, owner] of this.owners) if (owner === p.clientId) { this.owners.delete(id); this.states.delete(id); this.following.delete(id); this.emit('state', id, null); }
      }
      if (message.method === 'thread-stream-following-status-requested' && this.following.has(p.conversationId)) this.follow(p.conversationId, this.following.get(p.conversationId), true);
      if (message.method !== 'thread-stream-state-changed' || message.version !== 11 || p.hostId !== 'local') return;
      const id = p.conversationId, change = p.change;
      if (this.following.get(id) !== message.sourceClientId) return;
      if (change?.type === 'snapshot') {
        this.states.set(id, { revision: change.revision, state: change.conversationState });
      } else if (change?.type === 'patches') {
        const entry = this.states.get(id);
        if (!entry || entry.revision !== change.baseRevision) { this.follow(id, message.sourceClientId, true); return; }
        try {
          for (const patch of change.patches || []) entry.state = applyPatch(entry.state, patch);
          entry.revision = change.revision;
        } catch { this.states.delete(id); this.follow(id, message.sourceClientId, true); return; }
      }
      this.emit('state', id, this.states.get(id)?.state);
    }
  }
  async discover(id) {
    await this.connect();
    const response = await this.requestRaw('thread-owner-discovery', { hostId: 'local', conversationId: id });
    if (response.resultType !== 'success') {
      this.owners.delete(id); this.states.delete(id);
      if (response.error === 'no-client-found') return null;
      throw failure('未能找到电脑对话：' + response.error);
    }
    const owner = response.handledByClientId;
    this.owners.set(id, owner); this.follow(id, owner);
    return owner;
  }
  async acquire(id) {
    let owner = await this.discover(id);
    if (owner) return owner;
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw failure('对话编号无效');
    const url = `codex://threads/${id}`;
    // Open an existing conversation through the registered OS protocol handler.
    // This is only reached after the phone user explicitly submits a message.
    await new Promise((resolve, reject) => {
      const command = process.platform === 'win32' ? 'powershell.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`] : [url];
      execFile(command, args, { windowsHide: true, timeout: 5000 }, error => error ? reject(failure('无法打开电脑对话，请在 Codex 中打开后重试')) : resolve());
    });
    for (let i = 0; i < 12; i++) {
      await delay(500); owner = await this.discover(id); if (owner) return owner;
    }
    throw failure('电脑尚未打开这条对话，请在 Codex 中点开它后重试；消息已保留', 'desktop_thread_not_open');
  }
  follow(id, owner, force = false) {
    if (!force && this.following.get(id) === owner) return;
    this.following.set(id, owner);
    if (this.following.size > 8) {
      const [oldId, oldOwner] = this.following.entries().next().value;
      this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: this.clientId, targetClientIds: [oldOwner], params: { hostId: 'local', conversationId: oldId, following: false } });
      this.following.delete(oldId); this.owners.delete(oldId); this.states.delete(oldId); this.emit('state', oldId, null);
    }
    this.write({ type: 'broadcast', method: 'thread-stream-following-changed', version: 1, sourceClientId: this.clientId, targetClientIds: [owner], params: { hostId: 'local', conversationId: id, following: true } });
  }
  state(id) { return this.states.get(id)?.state || null; }
  async waitState(id) {
    if (this.state(id)) return this.state(id);
    return new Promise(resolve => {
      const finish = state => { clearTimeout(timer); this.off('state', listener); resolve(state); };
      const listener = (threadId, state) => { if (threadId === id) finish(state); };
      const timer = setTimeout(() => finish(null), 1000);
      this.on('state', listener);
    });
  }
  async call(id, method, params, owner = null) {
    owner ||= await this.discover(id);
    if (!owner) throw failure('请先在电脑 Codex 中打开这条对话，然后重试', 'desktop_thread_not_open');
    const response = await this.requestRaw(method, { conversationId: id, ...params }, { targetClientId: owner, timeoutMs: 35000 });
    if (response.resultType !== 'success') throw failure('电脑未能处理消息：' + response.error, 'desktop_request_failed');
    return response.result;
  }
  async send(id, input, options, owner) {
    const live = await this.waitState(id);
    const selection = options.model ? {
      collaborationMode: { mode: live?.latestCollaborationMode?.mode || 'default', settings: { ...live?.latestCollaborationMode?.settings, developer_instructions: live?.latestCollaborationMode?.settings?.developer_instructions || null, model: options.model, reasoning_effort: options.effort ?? null } },
    } : {};
    return this.call(id, 'thread-follower-start-turn', {
      turnStart: {
        request: { threadId: id, input, ...selection, clientUserMessageId: options.requestId || randomUUID() },
        context: { inheritThreadSettings: true },
      },
    }, owner);
  }
  close() { this.closed = true; this.socket?.destroy(); }
}

function applyPatch(root, patch) {
  const path = patch.path;
  if (!Array.isArray(path) || path.some(key => ['__proto__', 'constructor', 'prototype'].includes(String(key)))) throw new Error('Invalid desktop patch');
  if (!path.length) return patch.op === 'remove' ? null : patch.value;
  let target = root;
  for (const key of path.slice(0, -1)) { target = target[key]; if (target == null) throw new Error('Missing patch target'); }
  const key = path.at(-1);
  if (patch.op === 'remove') { if (Array.isArray(target)) target.splice(Number(key), 1); else delete target[key]; }
  else if (patch.op === 'add' && Array.isArray(target)) target.splice(Number(key), 0, patch.value);
  else if (patch.op === 'add' || patch.op === 'replace') target[key] = patch.value;
  else throw new Error('Unknown patch');
  return root;
}
