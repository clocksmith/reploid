import { readFileSync } from 'node:fs';
import { resolveServedFile } from '../browser-roots.js';

const manifest = resolveServedFile('/styles/poolday/layers.json');
const layers = JSON.parse(readFileSync(manifest, 'utf8'));

export const dailyPages = Object.freeze(['index.html', 'app.js', 'style.css', 'host.html', 'theme.js']);
export const poolStyles = Object.freeze([layers.tokens, ...layers.primitives]);
export const poolImports = poolStyles.map(file => `@import url("/styles/poolday/${file}");`).join('\n');
