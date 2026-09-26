import { createHmac } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

const DOMAIN = 'codex-pocket-discovery-v1';
export function connectionProof(token, nonce, port) {
  if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) return null;
  const urls = [...new Set(Object.values(networkInterfaces()).flatMap(entries => entries
    .filter(x => x.family === 'IPv4' && !x.internal)
    .map(x => `http://${x.address}:${port}`)))].slice(0, 16);
  const payload = JSON.stringify({ service: DOMAIN, nonce, port, urls });
  return { payload, proof: createHmac('sha256', token).update(payload).digest('hex') };
}

// Discovery never receives the pairing token. The phone verifies this proof before
// sending a bearer credential to an address learned from the local network.
export function startDiscovery(server, token, port, host) {
  if (!['0.0.0.0', '::'].includes(host)) return;
  const socket = createSocket('udp4');
  let windowStart = 0, count = 0;
  socket.on('error', () => { try { socket.close(); } catch {} });
  socket.on('message', (buffer, peer) => {
    if (buffer.length > 256) return;
    if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; }
    if (++count > 20) return;
    try {
      const request = JSON.parse(buffer.toString('utf8'));
      if (request.service !== DOMAIN) return;
      const answer = connectionProof(token, request.nonce, port);
      if (answer) socket.send(Buffer.from(JSON.stringify(answer)), peer.port, peer.address, () => {});
    } catch {}
  });
  socket.bind(port, '0.0.0.0');
  socket.unref();
  server.once('close', () => { try { socket.close(); } catch {} });
}
