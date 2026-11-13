// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('isolated deployment preparation', () => {
  for (const failPreparation of [false, true]) it(`prepares once before Cloud Build; failure=${failPreparation}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'reploid-deploy-routing-'));
    try {
      await mkdir(path.join(root, 'scripts'));
      await mkdir(path.join(root, 'bin'));
      await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
      await copyFile(path.resolve('scripts/deploy.js'), path.join(root, 'scripts/deploy.js'));
      const config = await readFile(path.resolve('firebase.json'), 'utf8');
      await writeFile(path.join(root, 'firebase.json'), config);
      const command = `#!/usr/bin/env node
import fs from 'node:fs'; import path from 'node:path';
const command = path.basename(process.argv[1]), args = process.argv.slice(2);
const event = { command, args };
if (command === 'git') {
  if (args[0] === 'rev-parse') process.stdout.write('revision\\n');
  if (args[0] === 'ls-remote') process.stdout.write('revision\\trefs/heads/main\\n');
  if (args[0] === 'clone') { fs.mkdirSync(path.join(args.at(-1), 'packages/functions'), {recursive:true}); fs.copyFileSync(process.env.FIXTURE_CONFIG, path.join(args.at(-1), 'firebase.json')); }
}
if (command === 'firebase') {
  const config = JSON.parse(fs.readFileSync(args[args.indexOf('--config') + 1]));
  event.predeploy = config.hosting.find(item => item.target === 'reploid').predeploy;
}
fs.appendFileSync(process.env.FIXTURE_TRACE, JSON.stringify(event) + '\\n');
if (command === 'npm' && args.join(' ') === 'run prepare:hosting' && process.env.FAIL_PREPARATION === '1') process.exit(7);
`;
      for (const name of ['git', 'npm', 'gcloud', 'firebase']) await writeFile(path.join(root, 'bin', name), command, { mode: 0o755 });
      const trace = path.join(root, 'trace.jsonl');
      const result = spawnSync(process.execPath, ['scripts/deploy.js'], { cwd: root, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, PATH: path.join(root, 'bin') + path.delimiter + process.env.PATH,
          FIXTURE_CONFIG: path.join(root, 'firebase.json'), FIXTURE_TRACE: trace, FAIL_PREPARATION: failPreparation ? '1' : '0' } });
      const events = (await readFile(trace, 'utf8').catch(error => { throw new Error(result.stderr, { cause: error }); })).trim().split('\n').map(JSON.parse);
      expect(events.filter(row => row.command === 'npm' && row.args.join(' ') === 'run prepare:hosting'), result.stderr + JSON.stringify(events)).toHaveLength(1);
      expect(await readFile(path.join(root, 'firebase.json'), 'utf8')).toBe(config);
      if (failPreparation) {
        expect(result.status).toBe(1);
        expect(events.some(row => ['gcloud', 'firebase'].includes(row.command))).toBe(false);
      } else {
        expect(result.status, result.stderr).toBe(0);
        const prepared = events.findIndex(row => row.command === 'npm' && row.args.join(' ') === 'run prepare:hosting');
        expect(events.findIndex(row => row.command === 'gcloud')).toBeGreaterThan(prepared);
        expect(events.find(row => row.command === 'firebase').predeploy).toBe('npm run verify:browser-bundle:local && node scripts/package-hosting.js --check');
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
