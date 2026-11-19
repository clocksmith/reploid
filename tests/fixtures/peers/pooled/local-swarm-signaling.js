// Owned loopback PublicSwarmServer for matched private split comparison signaling.
import assert from 'node:assert/strict';
import http from 'node:http';
import { PublicSwarmServer } from '../../../../server/public-swarm-server.js';

const port = Number(process.argv[2]);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535, 'Explicit unprivileged port required');
const host = process.argv[3] || '127.0.0.1';
assert(host === '127.0.0.1' || host === '::1', 'Loopback bind address required');

const logger = { log() {}, info() {}, debug() {}, warn: console.error, error: console.error };
const swarm = new PublicSwarmServer({ localPort: port, logger });
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, scope: 'local-swarm-signaling/v1', port }));
});
server.on('upgrade', (req, socket, head) => swarm.handleUpgrade(req, socket, head));

const shutdown = async () => {
  swarm.close();
  await new Promise(resolve => server.close(() => resolve()));
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => resolve());
});
console.log(JSON.stringify({ listening: true, host, port, path: swarm.bootstrap.path }));
