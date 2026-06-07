#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const envPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, 'deploy', 'env.production.json');

const config = JSON.parse(fs.readFileSync(envPath, 'utf8'));
const entries = Object.entries(config.runtimeEnv || {});
const allowPlaceholders = process.argv.includes('--allow-placeholders');
const placeholders = entries.filter(([, value]) => String(value || '').trim().startsWith('<required-'));
if (placeholders.length > 0 && !allowPlaceholders) {
  console.error(`Required deployment values are still placeholders in ${envPath}:`);
  for (const [key] of placeholders) console.error(`- ${key}`);
  process.exit(1);
}
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(config.runtimeEnv || {}, null, 2)}\n`);
} else {
  process.stdout.write(`${entries.map(([key, value]) => `${key}=${value}`).join(',')}\n`);
}
