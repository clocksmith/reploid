// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const profile = 'qwen3-6-35b-a3b-q4_0-pooled-q8-common-diagnostic.json';
const vendor = 'shared/vendor/doppler/0.7.4/';

describe('peer diagnostic shipping boundary', () => {
  it('retains the exact diagnostic identity only in explicit peer fixtures', () => {
    const bytes = readFileSync(`tests/fixtures/peers/pooled/${profile}`);
    expect(createHash('sha256').update(bytes).digest('hex'))
      .toBe('de27a1fd23f676039b06111b7abd1085b36dd682dcb7baa49fedfe882decf297');
    expect(JSON.parse(bytes).model).toBe('qwen-3-6-35b-a3b-text-source-q4_0-af32-pooled-q8-common');
    expect(existsSync(`${vendor}src/config/runtime/profiles/${profile}`)).toBe(false);
  });

  it('excludes the peer diagnostic from runtime reachability and served inventories', () => {
    for (const file of [
      `${vendor}src/config/kernels/registry.json`,
      'self/config/vfs-manifest.json',
      'docs/ownership-inventory.json',
      'apps/poolday/config/browser-bundle-manifest.json'
    ]) {
      expect(readFileSync(file, 'utf8'), file).not.toContain(profile.replace('.json', ''));
    }
  });
});
