import { describe, expect, it } from 'vitest';

import { exportSelfImage } from '../../self/image/export.js';

describe('Self Image Export', () => {
  it('exports the canonical /self image and boot contract', async () => {
    const files = new Map([
      ['/self/self.json', '{"mode":"reploid"}'],
      ['/self/boot.json', '{"schema":"reploid/self-boot/v1"}'],
      ['/self/runtime.js', 'export const runtime = true;'],
      ['/self/host/start-app.js', 'export const host = true;'],
      ['/artifacts/out.txt', 'ignore me']
    ]);

    const result = await exportSelfImage(
      {},
      {
        VFS: {
          list: async () => Array.from(files.keys())
        },
        readFile: async ({ path }) => ({
          path,
          content: files.get(path) || ''
        })
      }
    );

    expect(result.boot.schema).toBe('reploid/self-boot/v1');
    expect(Object.keys(result.files)).toContain('/self/self.json');
    expect(Object.keys(result.files)).toContain('/self/host/start-app.js');
    expect(Object.keys(result.files)).not.toContain('/artifacts/out.txt');
    expect(result.manifest.files.some((entry) => entry.path === '/self/runtime.js')).toBe(true);
  });
});
