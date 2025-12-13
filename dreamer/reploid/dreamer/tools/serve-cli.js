#!/usr/bin/env node
/**
 * serve-cli.js - Convert + Serve models for Dreamer
 *
 * Usage:
 *   node serve-cli.js <input> [--port <num>] [--output <dir>] [--keep]
 *
 * Input:
 *   - GGUF file: will be converted to .rdrr via convert-cli.js
 *   - .rdrr folder (contains manifest.json + shard_*.bin): served as-is
 */

import http from 'http';
import { readFile, stat, readdir, rm, mkdir } from 'fs/promises';
import { createReadStream } from 'fs';
import path, { extname, resolve, join, dirname } from 'path';
import os from 'os';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ------------ CLI PARSING ------------
function parseArgs(argv) {
  const args = {
    input: null,
    port: 8765,
    output: null,
    keep: false,
    open: true,
    dreamerUrl: 'http://localhost:5173',
    help: false,
  };

  const tokens = [...argv];
  while (tokens.length) {
    const arg = tokens.shift();
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--port' || arg === '-p') args.port = parseInt(tokens.shift(), 10);
    else if (arg === '--output' || arg === '-o') args.output = tokens.shift();
    else if (arg === '--keep') args.keep = true;
    else if (arg === '--no-open') args.open = false;
    else if (arg === '--dreamer-url') args.dreamerUrl = tokens.shift();
    else if (!args.input) args.input = arg;
  }
  return args;
}

function printHelp() {
  console.log(`
Dreamer Serve - Convert + Serve models for the Dreamer provider

Usage:
  node serve-cli.js <input> [options]

Input:
  - GGUF file (e.g., model.gguf)
  - .rdrr folder containing manifest.json and shard_*.bin

Options:
  --port, -p <num>   Port to serve on (default: 8765)
  --output, -o <dir> Output directory for converted .rdrr (default: temp)
  --keep             Keep converted .rdrr directory after exit
  --no-open          Don't auto-open browser
  --dreamer-url      Base URL for Dreamer (default: http://localhost:5173)
  --help             Show this help

Examples:
  node serve-cli.js model.gguf
  node serve-cli.js ./model-rdrr-folder --port 9000
  node serve-cli.js model.gguf --no-open
`);
}

// Open URL in default browser
function openBrowser(url) {
  const openCmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';

  exec(`${openCmd} "${url}"`, (err) => {
    if (err) {
      console.log(`Could not open browser automatically.`);
      console.log(`Please open: ${url}`);
    }
  });
}

// ------------ HELPERS ------------
async function detectInputType(inputPath) {
  const stats = await stat(inputPath);
  if (stats.isDirectory()) {
    const files = await readdir(inputPath);
    if (files.some(f => f === 'manifest.json')) return 'rdrr';
    throw new Error(`Directory ${inputPath} does not look like an .rdrr pack (missing manifest.json)`);
  }
  if (extname(inputPath).toLowerCase() === '.gguf') return 'gguf';
  throw new Error(`Unsupported input: ${inputPath} (must be .gguf or .rdrr folder)`);
}

async function runConvert(inputPath, outputDir) {
  const cliPath = resolve(__dirname, './convert-cli.js');
  await mkdir(outputDir, { recursive: true });
  console.log(`[serve-cli] Converting GGUF → .rdrr at ${outputDir}`);
  await new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(process.execPath, [cliPath, inputPath, outputDir], {
      stdio: 'inherit',
    });
    proc.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`convert-cli exited with code ${code}`));
    });
  });
  return outputDir;
}

async function validateRDRR(dir) {
  const manifestPath = join(dir, 'manifest.json');
  try {
    await stat(manifestPath);
  } catch {
    throw new Error(`manifest.json not found in ${dir}`);
  }
  const files = await readdir(dir);
  const hasShard = files.some(f => f.startsWith('shard_') && f.endsWith('.bin'));
  if (!hasShard) {
    throw new Error(`No shard_*.bin files found in ${dir}`);
  }
}

function contentTypeFor(ext) {
  switch (ext) {
    case '.json': return 'application/json';
    case '.bin': return 'application/octet-stream';
    default: return 'application/octet-stream';
  }
}

function startServer(serveDir, args) {
  const { port, open, dreamerUrl } = args;

  const server = http.createServer(async (req, res) => {
    // CORS headers for cross-origin requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    try {
      const reqUrl = new URL(req.url, `http://localhost:${port}`);
      let relativePath = decodeURIComponent(reqUrl.pathname);
      if (relativePath === '/') relativePath = '/';

      const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
      let target = join(serveDir, safePath);
      const rel = path.relative(serveDir, target);
      if (rel.startsWith('..')) {
        res.writeHead(403);
        return res.end('Forbidden');
      }

      let stats;
      try {
        stats = await stat(target);
      } catch {
        res.writeHead(404);
        return res.end('Not found');
      }

      if (stats.isDirectory()) {
        target = join(target, 'manifest.json');
      }

      const ext = path.extname(target).toLowerCase();
      res.setHeader('Content-Type', contentTypeFor(ext));
      res.writeHead(200);
      const stream = createReadStream(target);
      stream.pipe(res);
      stream.on('error', (err) => {
        console.error('[serve-cli] Stream error:', err);
        res.destroy(err);
      });
    } catch (err) {
      console.error('[serve-cli] Request error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
      }
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    const modelUrl = `http://localhost:${port}`;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Model ready at: ${modelUrl}`);
    console.log(`${'─'.repeat(50)}\n`);

    if (open) {
      // Build Dreamer URL with pre-filled model URL
      const fullDreamerUrl = `${dreamerUrl}/?provider=dreamer&modelUrl=${encodeURIComponent(modelUrl)}`;
      console.log(`Opening Dreamer: ${fullDreamerUrl}\n`);
      openBrowser(fullDreamerUrl);
    } else {
      console.log('Paste this URL into the Dreamer boot screen (Model URL field).\n');
    }

    console.log('Press Ctrl+C to stop the server.\n');
  });

  return server;
}

// ------------ MAIN ------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const inputPath = resolve(args.input);
  const inputType = await detectInputType(inputPath);

  let serveDir = inputPath;
  let tempDir = null;

  if (inputType === 'gguf') {
    tempDir = args.output ? resolve(args.output) : path.join(os.tmpdir(), `dreamer-rdrr-${Date.now()}`);
    serveDir = await runConvert(inputPath, tempDir);
  }

  await validateRDRR(serveDir);
  startServer(serveDir, args);

  // Cleanup on exit
  const cleanup = async () => {
    if (!args.keep && tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        console.log(`[serve-cli] Removed temp directory ${tempDir}`);
      } catch (err) {
        console.warn('[serve-cli] Failed to remove temp directory:', err.message);
      }
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('[serve-cli] Error:', err.message);
  process.exit(1);
});
