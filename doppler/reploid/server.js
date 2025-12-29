/**
 * Simple static file server for Reploid
 * Serves the browser-based agent UI for E2E testing
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// Serve static files from root
app.use(express.static(__dirname, {
  extensions: ['html', 'js', 'css', 'json', 'svg', 'png', 'ico'],
  setHeaders: (res, path) => {
    // Enable SharedArrayBuffer for Doppler
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Cross-Origin-Embedder-Policy', 'require-corp');

    // Cache control
    if (path.endsWith('.js') || path.endsWith('.css')) {
      res.set('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// Serve reploid.html for root
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'reploid.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.listen(PORT, () => {
  console.log(`Reploid server running at http://localhost:${PORT}`);
  console.log(`  Boot UI: http://localhost:${PORT}/`);
  console.log(`  Health:  http://localhost:${PORT}/health`);
});
