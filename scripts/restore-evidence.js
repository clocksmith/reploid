#!/usr/bin/env node
import path from 'node:path';
import { readEvidenceCatalog, checkEvidenceObjects, fetchEvidenceObjects, restoreEvidenceFile } from './retained-evidence.js';

const args = process.argv.slice(2);
const fetchIndex = args.indexOf('--fetch');
if (fetchIndex >= 0) args.splice(fetchIndex, 1);
const catalog = await readEvidenceCatalog();
if (fetchIndex >= 0) fetchEvidenceObjects(catalog);
if (args.length === 1 && args[0] === '--check') {
  const missing = checkEvidenceObjects(catalog);
  if (missing.length) throw new Error(`${missing.length} evidence blobs are absent; run node scripts/restore-evidence.js --fetch --check`);
  console.log(`Verified Git availability and sizes for ${catalog.fileCount} retained evidence files (${catalog.bytes} bytes).`);
} else if (args.length >= 1 && args.length <= 2 && !args[0].startsWith('-')) {
  const prefix = args[0];
  const rows = [...catalog.files.values()].filter(row => row.path === prefix || row.path.startsWith(prefix.replace(/\/$/, '') + '/'));
  if (!rows.length) throw new Error('No retained evidence matches that repository-relative path');
  for (const row of rows) await restoreEvidenceFile(row, { destination: args[1] ? path.resolve(args[1]) : undefined });
  console.log(`Restored and hash-verified ${rows.length} retained evidence files.`);
} else throw new Error('Usage: restore-evidence.js [--fetch] --check | REPOSITORY_PATH [DESTINATION_ROOT]');
