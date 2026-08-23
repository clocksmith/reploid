#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { verifyChangePassportExport } from '../self/core/change-passport.js';

export async function verifyChangePassportFile(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  if (!filePath) throw new Error('Change Passport export path is required');
  const exported = JSON.parse(await fs.readFile(resolved, 'utf8'));
  return verifyChangePassportExport(exported);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);
if (invokedPath === currentPath) {
  const target = process.argv[2];
  try {
    const result = await verifyChangePassportFile(target);
    process.stdout.write(`${JSON.stringify({
      valid: result.valid,
      passportId: result.projection?.passportId || null,
      eventCount: result.integrity.eventCount,
      headHash: result.integrity.headHash,
      exportHash: result.exportHash,
      reasons: result.reasons
    }, null, 2)}\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
