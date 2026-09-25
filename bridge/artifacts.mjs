import { realpath, stat, readFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const types = {
  '.html': 'text/html', '.htm': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'text/plain',
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.csv': 'text/plain',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const maxBytes = 20 * 1024 * 1024;
const invalid = message => Object.assign(new Error(message), { statusCode: 400, code: 'artifact_unavailable' });
const within = (root, path) => { const part = relative(root, path); return part !== '..' && !part.startsWith('..' + sep) && !isAbsolute(part); };
const safeParts = path => !path.split(/[\\/]/).some(p => p.startsWith('.') || /^(?:node_modules|runtime|secrets?|credentials?)(?:\.|$)/i.test(p));
const artifactId = path => createHash('sha256').update(path).digest('hex').slice(0, 32);

function candidates(thread) {
  const paths = new Set();
  for (const message of thread.messages || []) {
    if (message.role !== 'assistant' && message.tool?.type !== 'fileChange') continue;
    const text = message.text || '';
    for (const match of text.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)/g)) paths.add(match[1].replace(/^<|>$/g, '').replace(/\s+"[^"]*"$/, ''));
    for (const match of text.matchAll(/`([^`\r\n]+)`/g)) paths.add(match[1]);
    for (const change of message.tool?.changes || []) if (change.path) paths.add(change.path);
  }
  for (const tool of thread.tools || []) for (const change of tool.changes || []) if (change.path) paths.add(change.path);
  return [...paths].slice(0, 300);
}

async function resolveFile(root, base, value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let name = value.trim();
  try {
    if (/^file:/i.test(name)) name = fileURLToPath(name);
    else if (/^(?:https?:|data:|blob:|javascript:|sandbox:|#)/i.test(name)) return null;
    else name = decodeURIComponent(name.replace(/#.*$/, '').replace(/\?.*$/, ''));
    if (process.platform === 'win32' && /^\/[A-Za-z]:[\\/]/.test(name)) name = name.slice(1);
    // Assistant file links may carry a source line number.
    name = name.replace(/:(\d+)(?::\d+)?$/, '');
    const path = await realpath(resolve(base, name));
    if (!within(root, path) || !safeParts(relative(root, path)) || !types[extname(path).toLowerCase()]) return null;
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { path, info, mime: types[extname(path).toLowerCase()] };
  } catch { return null; }
}

async function filesFor(thread) {
  if (!thread.cwd) return [];
  const root = await realpath(thread.cwd).catch(() => null);
  if (!root) return [];
  const found = new Map();
  for (const candidate of candidates(thread)) {
    const file = await resolveFile(root, root, candidate);
    if (file) found.set(artifactId(file.path), { ...file, root });
    if (found.size >= 60) break;
  }
  return [...found].map(([id, file]) => ({ id, ...file }));
}

const describe = file => ({ id: file.id, name: basename(file.path), relativePath: relative(file.root, file.path), size: file.info.size, modifiedAt: file.info.mtimeMs, mime: file.mime, available: file.info.size <= maxBytes });
export async function listArtifacts(thread) { return (await filesFor(thread)).map(describe); }

async function replaceAsync(text, pattern, transform) {
  const matches = [...text.matchAll(pattern)];
  const values = [];
  for (const match of matches) values.push(await transform(match));
  let index = 0;
  return text.replace(pattern, () => values[index++]);
}

async function bundleHtml(file, source) {
  let remaining = maxBytes, count = 0;
  const seen = new Set([file.path]);
  const css = (text, base, depth) => replaceAsync(text, /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi, async m => `url("${await resource(m[2], base, depth)}")`);
  async function resource(value, base, depth = 0) {
    if (/^(?:data:|#)/i.test(value)) return value;
    if (depth > 4 || count >= 64) return '';
    const asset = await resolveFile(file.root, base, value);
    if (!asset || seen.has(asset.path) || asset.info.size > remaining || asset.mime === 'text/html') return '';
    seen.add(asset.path); count++; remaining -= asset.info.size;
    let bytes = await readFile(asset.path);
    if (asset.mime === 'text/css') bytes = Buffer.from(await css(bytes.toString('utf8'), dirname(asset.path), depth + 1));
    seen.delete(asset.path);
    return `data:${asset.mime};base64,${bytes.toString('base64')}`;
  }
  let html = await replaceAsync(source, /\b(src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, async m => `${m[1]}="${(await resource(m[2] ?? m[3] ?? m[4], dirname(file.path))).replace(/"/g, '&quot;')}"`);
  html = await css(html, dirname(file.path), 0);
  // Opaque-origin iframe; local assets are embedded, no bridge token or network access.
  const policy = "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' data:; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1">${html}`;
}

export async function readArtifact(thread, id) {
  const file = (await filesFor(thread)).find(f => f.id === id);
  if (!file) throw invalid('文件已移走，或不在这条对话的项目目录中。请刷新作品列表。');
  if (file.info.size > maxBytes) throw invalid('文件超过 20 MB，请在电脑上查看');
  const bytes = await readFile(file.path);
  if (bytes.length > maxBytes) throw invalid('文件超过 20 MB，请在电脑上查看');
  const result = { ...describe(file), base64: bytes.toString('base64') };
  if (file.mime === 'text/html') result.html = await bundleHtml(file, bytes.toString('utf8'));
  else if (file.mime.startsWith('text/')) result.text = bytes.toString('utf8');
  return result;
}
