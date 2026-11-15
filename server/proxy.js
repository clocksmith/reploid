#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxy } from './proxy-app.js';

export { createProxy } from './proxy-app.js';

/** Explicit process entry; importing this module never listens or changes handlers. */
export async function startProxy() {
  dotenv.config();
  const runtime = await createProxy();
  const shutdown = () => { void close().catch(error => { console.error(error); process.exitCode = 1; }); };
  async function close() {
    process.off('SIGTERM', shutdown);
    process.off('SIGINT', shutdown);
    await runtime.close();
  }
  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen({ port: runtime.port, ...(runtime.host ? { host: runtime.host } : {}) }, () => {
        runtime.server.off('error', reject);
        resolve();
      });
    });
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
    void runtime.startServices().catch(error => console.error('Runtime services failed:', error));
    console.log(`HTTP API: http://localhost:${runtime.server.address().port}`);
    return { ...runtime, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startProxy().catch(error => { console.error('[Proxy] Startup failed:', error); process.exitCode = 1; });
}
