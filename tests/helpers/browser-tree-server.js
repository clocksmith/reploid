/** Static acceptance fixture for the composed browser tree. No backend services or model execution. */
import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPOSITORY_ROOT, serveBrowserTree } from '../../server/browser-tree.js';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Supply an explicit local test port');
const common = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, 'deploy/firebase-common.json'), 'utf8'));
const app = express();
app.use((req, res, next) => {
  const rewrite = common.rewrites[req.path];
  if (rewrite) {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    req.url = rewrite.destination + query;
  }
  for (const header of common.headers.uncached) res.setHeader(header.key, header.value);
  next();
});
app.use(serveBrowserTree());
const server = app.listen(port, '127.0.0.1', () => console.log(`Composed browser fixture on 127.0.0.1:${port}`));
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
