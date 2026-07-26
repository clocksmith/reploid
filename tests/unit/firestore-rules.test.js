import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const rulesPath = resolve(process.cwd(), 'firestore.rules');

describe('hosted Firestore boundary', () => {
  it('denies all direct client reads and writes', async () => {
    const rules = await readFile(rulesPath, 'utf8');
    expect(rules).toMatch(/match \/\{document=\*\*\}/);
    expect(rules).toMatch(/allow read,\s*write:\s*if false;/);
    expect(rules).not.toMatch(/allow\s+(?:read|write|create|update|delete)[^;]*if\s+(?!false)/);
  });
});
