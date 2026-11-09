import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { serveBrowserTree } from './browser-tree.js';

/** Mount the composed browser namespace without depending on the entrypoint's directory. */
export function mountProxyStaticRoutes(app, { serverDirectory: __dirname, browserFile, decoFeedback, decoFeedbackOptions, dopplerDemoDir, dopplerKernelDir, dopplerRootDir, protoRootDir, staticRootDir }) {
app.use((req, res, next) => {
  // Set correct MIME type for WebGPU shader files
  if (req.path.endsWith('.wgsl')) {
    res.type('text/plain; charset=utf-8');
  }
  next();
});

const setStaticHeaders = (res, filePath) => {
  if (filePath.endsWith('.wgsl')) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
};

const PRODUCT_ROUTES = ['/', '/work', '/network', '/improve', '/examples', '/experiments', '/ask', '/compute', '/records', '/room-1', '/history'];
const CHANGE_PASSPORT_ROUTES = ['/passports'];
const SUBSTRATE_ROUTES = ['/zero', '/x'];
const sendUiFile = async (res, filePath) => {
  if (!decoFeedback || !decoFeedbackOptions) {
    res.sendFile(filePath);
    return;
  }
  const html = await fs.promises.readFile(filePath, 'utf8');
  res.type('html').send(decoFeedback.injectFeedbackBridgeHtml(html, decoFeedbackOptions));
};

// Main routes
app.get(PRODUCT_ROUTES, async (req, res) => {
  res.setHeader('X-Reploid-Experience', 'browser-inference-pool');
  await sendUiFile(res, browserFile('pool-entry.html'));
});

app.get(CHANGE_PASSPORT_ROUTES, async (req, res) => {
  res.setHeader('X-Reploid-Experience', 'change-passport');
  await sendUiFile(res, browserFile('change-passport-entry.html'));
});

app.get(SUBSTRATE_ROUTES, async (req, res) => {
  res.setHeader('X-Reploid-Experience', req.path === '/zero' ? 'zero' : 'x');
  await sendUiFile(res, browserFile('index.html'));
});

app.get(['/doppler', '/doppler/'], (req, res) => {
  res.sendFile(path.join(dopplerDemoDir, 'index.html'));
});

app.get('/design', (req, res) => {
  res.sendFile(browserFile('design.html'));
});

// Poolday tokens, primitives and live component specimens, read from styles/poolday.
app.get(['/design/poolday', '/design/poolday/'], (req, res) => {
  res.sendFile(browserFile('poolday-design.html'));
});

app.get('/SECURITY_AUDIT.md', (req, res) => {
  res.type('text/markdown; charset=utf-8');
  res.sendFile(path.join(__dirname, '..', 'docs', 'SECURITY_AUDIT.md'));
});

app.get(['/audit', '/audit/'], (req, res) => {
  res.sendFile(browserFile('audit.html'));
});

app.get('/reset', (req, res) => {
  res.sendFile(browserFile('reset.html'));
});

// Serve DOPPLER assets from the local runtime source of truth.
app.use('/doppler', express.static(dopplerRootDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wgsl')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
  }
}));

app.use('/proto', express.static(protoRootDir, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wgsl')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
  }
}));

// Back-compat for kernel fetches that still target /gpu/kernels.
app.use('/gpu/kernels', express.static(dopplerKernelDir, {
  setHeaders: (res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  }
}));

app.use(staticRootDir
  ? express.static(staticRootDir, { setHeaders: (res, filePath) => setStaticHeaders(res, filePath) })
  : serveBrowserTree({ setHeaders: setStaticHeaders }));

// 404 handler
app.use((req, res) => {
  res.status(404).send('File not found');
});
}
