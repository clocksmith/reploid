// Loopback-only, read-only serving of exact local diagnostic model bytes.
import { createServer } from 'node:http';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = process.env.DOPPLER_CHAT_MODEL_DIR;
if (!root) throw Error('DOPPLER_CHAT_MODEL_DIR is required');
const port = Number(process.env.REPLOID_MODEL_PORT || 9230);
export const server = createServer(async (request, response) => {
  // The catalog-origin redirect has an opaque Origin. These loopback-only,
  // read-only diagnostic files need no cookies or other caller credentials.
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Range');
  response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  const name = new URL(request.url, 'http://localhost').pathname.slice(1);
  if (!/^[\w.-]+$/.test(name) || name.includes('..') || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(400).end(); return;
  }
  let file;
  try {
    file = await open(resolve(root, name), 'r');
    const size = (await file.stat()).size;
    const range = request.headers.range;
    const match = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    if (range && !match) { response.writeHead(416).end(); return; }
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : size - 1;
    if (start > end || end >= size) { response.writeHead(416).end(); return; }
    response.setHeader('Content-Length', end - start + 1);
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    if (match) response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    response.writeHead(match ? 206 : 200);
    if (request.method === 'HEAD') { response.end(); return; }
    const stream = file.createReadStream({ start, end, autoClose: false });
    await new Promise((done, reject) => { stream.on('error', reject); response.on('close', () => { stream.destroy(); done(); }); stream.pipe(response); });
  } catch (error) { if (!response.headersSent) response.writeHead(404); response.end(); }
  finally { await file?.close(); }
});
server.listen(port, '127.0.0.1', () => console.log(`Diagnostic model server on loopback port ${server.address().port}`));
process.on('SIGTERM', () => server.close());
