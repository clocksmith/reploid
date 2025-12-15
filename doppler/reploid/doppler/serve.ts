#!/usr/bin/env node
/**
 * DOPPLER Development Server - Serves demo UI and model files.
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import { readFile, stat, readdir } from 'fs/promises';
import { createReadStream, Stats } from 'fs';
import { extname, join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export interface ServerOptions {
  port: number;
  open: boolean;
  help: boolean;
}

export interface ModelInfo {
  path: string;
  name: string;
  architecture?: string | null;
  quantization?: string | null;
  size?: string | null;
  downloadSize?: number;
  vocabSize?: number | null;
  numLayers?: number | null;
}

function parseArgs(argv: string[]): ServerOptions {
  const args: ServerOptions = {
    port: 8080,
    open: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--port' || arg === '-p') {
      args.port = parseInt(argv[++i], 10);
    } else if (arg === '--open' || arg === '-o') {
      args.open = true;
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
DOPPLER Development Server

Serves the demo UI and model files from a single server.

Usage:
  node serve.js [options]

Options:
  --port, -p <num>   Port to serve on (default: 8080)
  --open, -o         Open browser automatically
  --help, -h         Show this help

Demo URL:
  http://localhost:<port>/demo/

Models are served from:
  http://localhost:<port>/models/<model-name>/
`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;

  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.log(`Could not open browser automatically. Visit: ${url}`);
    }
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const { port } = args;
  const rootDir = __dirname;

  function serveFile(filePath: string, stats: Stats, req: IncomingMessage, res: ServerResponse): void {
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (match) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10) || 0;
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
        });

        const stream = createReadStream(filePath, { start, end });
        stream.pipe(res);
        return;
      }
    }

    const headers: Record<string, string | number> = {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Accept-Ranges': 'bytes',
    };

    if (ext === '.js' || ext === '.mjs') {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }

    res.writeHead(200, headers);

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.pipe(res);
  }

  const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      let pathname = decodeURIComponent(url.pathname);

      if (pathname === '/api/models') {
        const modelsDir = join(rootDir, 'models');
        try {
          const entries = await readdir(modelsDir, { withFileTypes: true });
          const models: ModelInfo[] = [];
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const modelPath = `models/${entry.name}`;
            const manifestPath = join(modelsDir, entry.name, 'manifest.json');
            try {
              const manifestData = await readFile(manifestPath, 'utf-8');
              const manifest = JSON.parse(manifestData);
              const config = manifest.config || {};
              const textConfig = config.text_config || config;
              const totalSize = (manifest.shards || []).reduce((sum: number, s: { size?: number }) => sum + (s.size || 0), 0);
              models.push({
                path: modelPath,
                name: entry.name,
                architecture: manifest.architecture || config.architectures?.[0] || null,
                quantization: manifest.quantization || null,
                size: textConfig.hidden_size ? `${textConfig.num_hidden_layers || 0}L/${textConfig.hidden_size}H` : null,
                downloadSize: totalSize,
                vocabSize: textConfig.vocab_size || null,
                numLayers: textConfig.num_hidden_layers || null,
              });
            } catch {
              models.push({ path: modelPath, name: entry.name });
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(models));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end('[]');
        }
      }

      if (pathname === '/' || pathname === '') {
        pathname = '/demo/index.html';
      }

      const safePath = pathname.replace(/^(\.\.[/\\])+/, '').replace(/\.\./g, '');
      const filePath = join(rootDir, safePath);

      const resolved = resolve(filePath);
      if (!resolved.startsWith(rootDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      let stats: Stats;
      try {
        stats = await stat(filePath);
      } catch {
        res.writeHead(404);
        return res.end('Not found');
      }

      if (stats.isDirectory()) {
        const indexPath = join(filePath, 'index.html');
        try {
          stats = await stat(indexPath);
          return serveFile(indexPath, stats, req, res);
        } catch {
          res.writeHead(404);
          return res.end('Not found');
        }
      }

      return serveFile(filePath, stats, req, res);
    } catch (err) {
      console.error('Server error:', err);
      res.writeHead(500);
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    const demoUrl = `http://localhost:${port}/demo/`;
    console.log(`
DOPPLER Development Server
==========================
Demo:   ${demoUrl}
Models: http://localhost:${port}/models/

Press Ctrl+C to stop
`);

    if (args.open) {
      openBrowser(demoUrl);
    }
  });

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.close(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});

export { parseArgs };
