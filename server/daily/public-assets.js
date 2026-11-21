import { readFileSync } from 'node:fs';

const manifest = new URL('../../apps/poolday/styles/poolday/layers.json', import.meta.url);
const layers = JSON.parse(readFileSync(manifest, 'utf8'));

export const dailyPages = Object.freeze(['index.html', 'app.js', 'style.css', 'host.html', 'theme.js']);
export const poolStyles = Object.freeze([layers.tokens, ...layers.primitives]);
export const poolImports = poolStyles.map(file => `@import url("/styles/poolday/${file}");`).join('\n');
