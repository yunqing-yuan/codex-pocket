const SERVICE = 'codex-pocket-discovery-v1';
const bytes = text => new TextEncoder().encode(text);
const hex = data => [...new Uint8Array(data)].map(n => n.toString(16).padStart(2, '0')).join('');
function cleanUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/$/, '');
  } catch { return ''; }
}

export function connectionRoutes({ getConfig, request, nativeCall, isNative, save }) {
  let pending = null, checkedAt = 0, revision = 0;
  async function resolveRoute() {
    const config = getConfig(), token = config.token, original = config.baseUrl, generation = revision;
    if (!token || !original) return;
    const nonce = hex(crypto.getRandomValues(new Uint8Array(32)));
    const key = await crypto.subtle.importKey('raw', bytes(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    async function verify(answer, candidate) {
      if (typeof answer?.payload !== 'string' || answer.payload.length > 8192 || !/^[a-f0-9]{64}$/.test(answer.proof || '')) throw new Error('电脑身份未确认');
      const proof = Uint8Array.from(answer.proof.match(/../g), pair => parseInt(pair, 16));
      if (!await crypto.subtle.verify('HMAC', key, proof, bytes(answer.payload))) throw new Error('电脑身份不匹配');
      const data = JSON.parse(answer.payload);
      if (data.service !== SERVICE || data.nonce !== nonce || !Array.isArray(data.urls)) throw new Error('电脑身份未确认');
      const urls = [...new Set(data.urls.map(cleanUrl).filter(Boolean))].slice(0, 16);
      // A new route must itself be signed, not just carry a copied valid response.
      if (candidate !== original && !urls.includes(candidate)) throw new Error('电脑地址未确认');
      return { url: candidate, urls };
    }
    async function probe(url) {
      try {
        return await verify(await request(url, '/pocket/identity?nonce=' + nonce, '', 2500), url);
      } catch (error) {
        // Old bridges remain usable at the address explicitly entered by the user.
        if (url === original && error.status === 401 && !config.routeProof) {
          const health = await request(url, '/health', token, 5000);
          if (health?.ok && health.bridge === 'codex-pocket') return { url, urls: [], legacy: true };
        }
        throw error;
      }
    }
    let route;
    try { route = await probe(original); }
    catch {
      const candidates = [...new Set((config.urls || []).map(cleanUrl).filter(url => url && url !== original))].slice(0, 16);
      const work = candidates.map(probe);
      if (isNative()) work.push((async () => {
        const port = Number(new URL(original).port) || (original.startsWith('https:') ? 443 : 80);
        const result = await nativeCall('PocketNetwork', 'discover', { nonce, port });
        return Promise.any((result?.replies || []).map(reply => verify(reply, cleanUrl(reply.url))));
      })());
      try { route = await Promise.any(work); }
      catch { throw new Error('暂时找不到已配对的电脑，请确认电脑已连接热点或两端 Tailscale 在线'); }
    }
    if (getConfig() !== config || config.token !== token) return;
    const urls = [...new Set([route.url, ...route.urls, original, ...(config.urls || [])])].slice(0, 16);
    const changed = route.url !== config.baseUrl || JSON.stringify(urls) !== JSON.stringify(config.urls || []) || (!route.legacy && !config.routeProof);
    config.baseUrl = route.url; config.urls = urls;
    if (!route.legacy) config.routeProof = true;
    checkedAt = generation === revision ? Date.now() : 0;
    if (changed) await save();
  }
  return {
    invalidate() { checkedAt = 0; revision++; },
    ensure() {
      if (pending) return pending;
      if (Date.now() - checkedAt < 15000) return Promise.resolve();
      pending = resolveRoute().finally(() => { pending = null; });
      return pending;
    },
  };
}
