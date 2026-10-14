// Run-1 loopback host for the installed signed export. Tooling only: it serves the
// unchanged hosting payload (.firebase-hosting/reploid, bundle c6de2012...) with the export's
// own firebase.json rewrites and cache headers, the catalog's inherited loopback closure URL
// (/qualification/capsule/artifacts/model/, used only by explicit file acquisition), and the
// application's own PublicSwarmServer at /swarm. It binds 127.0.0.1 only.
// server/proxy.js (the precedent's host) listens on every interface, so it is not used.
// Usage: node app-server.mjs <export app dir> <capsule dir> <port> <model request log>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [appDir, capsuleDir, portArg, requestLog] = process.argv.slice(2);
const port = Number(portArg);
if (!appDir || !capsuleDir || !Number.isInteger(port) || !requestLog) throw Error('Usage: app-server.mjs APP CAPSULE PORT LOG');
const require = createRequire(path.join(appDir, 'package.json'));
const express = require('express');
const { PublicSwarmServer } = await import(pathToFileURL(path.join(appDir, 'server/public-swarm-server.js')).href);

const payload = path.join(appDir, '.firebase-hosting/reploid');
const firebase = JSON.parse(fs.readFileSync(path.join(appDir, 'firebase.json'), 'utf8'));
const hosting = [].concat(firebase.hosting).find(entry => entry.public === '.firebase-hosting/reploid');
if (!hosting) throw Error('Hosting target for the payload not found');
const rewrites = new Map(hosting.rewrites.filter(row => row.destination).map(row => [row.source, row.destination]));
const noCacheExt = /\.(html|js|css|json)$/;
const log = fs.createWriteStream(requestLog, { flags: 'wx' });
const record = row => log.write(JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');

const app = express();
app.disable('x-powered-by');
// Explicit acquisition source named by the catalog (source.baseUrl). Every request is logged.
app.use('/qualification/capsule/artifacts/model', (req, res, next) => {
  res.on('finish', () => record({ kind: 'model-file', method: req.method, path: req.path, range: req.headers.range ?? null,
    status: res.statusCode, origin: req.headers.origin ?? null }));
  next();
}, express.static(path.join(capsuleDir, 'artifacts/model'), { index: false, dotfiles: 'deny', fallthrough: false, etag: false }));
app.use((req, res, next) => {
  const destination = rewrites.get(req.path);
  if (destination && (req.path === '/' || !fs.existsSync(path.join(payload, req.path)))) req.url = destination + req.url.slice(req.path.length);
  next();
});
app.use(express.static(payload, { index: ['index.html'], dotfiles: 'ignore', setHeaders(res, filePath) {
  if (noCacheExt.test(filePath)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (filePath.endsWith('.wgsl')) res.setHeader('Content-Type', 'text/plain; charset=utf-8');
} }));
app.use((req, res) => { res.status(404).send('File not found'); });

const server = http.createServer(app);
const swarm = new PublicSwarmServer({ localPort: port, logger: {
  log: (...args) => record({ kind: 'swarm', message: String(args[0]).slice(0, 200) }),
  info: (...args) => record({ kind: 'swarm', message: String(args[0]).slice(0, 200) }),
  warn: (...args) => record({ kind: 'swarm-warn', message: String(args[0]).slice(0, 200) }),
  error: (...args) => record({ kind: 'swarm-error', message: String(args[0]).slice(0, 200) }),
  debug: () => {}
} });
server.on('upgrade', (req, socket, head) => {
  record({ kind: 'upgrade', path: new URL(req.url, 'http://loopback.invalid').pathname, origin: req.headers.origin ?? null });
  if (swarm.shouldHandle(req)) swarm.handleUpgrade(req, socket, head); else socket.destroy();
});
server.listen(port, '127.0.0.1', () => {
  record({ kind: 'listening', address: server.address(), pid: process.pid });
  console.log(JSON.stringify({ listening: `http://127.0.0.1:${port}`, pid: process.pid }));
});
const stop = () => {
  record({ kind: 'stopping', pid: process.pid });
  try { swarm.close(); } catch {}
  server.closeAllConnections(); server.close(() => { log.end(() => process.exit(0)); });
};
process.once('SIGTERM', stop); process.once('SIGINT', stop);
