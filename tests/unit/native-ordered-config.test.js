// @vitest-environment node
import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const run = promisify(execFile);
it('CLI advertises opt-in and rejects malformed or mixed config before identity/module/connection side effects', async () => {
  const script = new URL('../../server/native-participant.js', import.meta.url).pathname;
  expect((await run(process.execPath,[script,'--help'],{timeout:10000})).stdout).toContain('--ordered-config');
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'ordered-config-'));
  try {
    const config = path.join(root,'ordered.json'), identity = path.join(root,'identity.json');
    const args = [script,'--connect-only','--model','unused','--model-directory',root,'--identity-file',identity,
      '--rtc-module','/must-not-import-rtc','--ws-module','/must-not-import-ws','--ordered-config',config];
    for (const value of [null,{}]) {
      await fs.writeFile(config,JSON.stringify(value));
      const failure = await run(process.execPath,args,{timeout:10000}).catch(error=>error);
      expect(failure.stderr).toMatch(/Ordered config requires|Explicit ordered host limit/);
      await expect(fs.stat(identity)).rejects.toMatchObject({code:'ENOENT'});
    }
    const failure = await run(process.execPath,[...args,'--canonical'],{timeout:10000}).catch(error=>error);
    expect(failure.stderr).toContain('ordinary execution');
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
