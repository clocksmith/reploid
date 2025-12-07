#!/usr/bin/env node
/**
 * Static file server with proper MIME types for WGSL shaders
 * Replaces Python http.server for Dreamer compatibility
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const PORT = process.env.STATIC_PORT || 8080;

// Extended MIME types including WGSL
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  // WebGPU shaders - critical for Dreamer
  '.wgsl': 'text/plain; charset=utf-8',
  // Model files
  '.gguf': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.safetensors': 'application/octet-stream',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  // Parse URL and remove query string
  let urlPath = req.url.split('?')[0];

  // Default to index.html
  if (urlPath === '/') {
    urlPath = '/index.html';
  }

  // Security: prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  // Check if path is within ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Try index.html for directories
      if (stats?.isDirectory()) {
        const indexPath = path.join(filePath, 'index.html');
        fs.readFile(indexPath, (err, data) => {
          if (err) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(data);
          }
        });
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    const mimeType = getMimeType(filePath);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }

      res.writeHead(200, {
        'Content-Type': mimeType,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  });
});

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║                                                        ║
║   REPLOID Static Server                               ║
║                                                        ║
║   URL: http://localhost:${PORT}                           ║
║   Root: ${ROOT.substring(0, 40).padEnd(40)}   ║
║   WGSL: ✓ Supported                                   ║
║                                                        ║
║   Press Ctrl+C to stop                                ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
  `);
});
