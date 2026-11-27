// @vitest-environment node
// verify:js-only fails on Python or Go files and on JavaScript that starts Python or Go. Fixture text is assembled
// from pieces so this file does not itself trip the check.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkJsOnly, findShellViolations, findSpawnViolations } from '../../scripts/verify-js-only.js';

const script = fileURLToPath(new URL('../../scripts/verify-js-only.js', import.meta.url));
const PY = 'py' + 'thon3', GO = 'g' + 'o';
const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'js-only-'));
  roots.push(root);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
}

describe('verify:js-only', () => {
  it('passes plain JavaScript, Node child processes and WGSL', () => {
    const files = {
      'a.js': "import { spawn } from 'node:child_process';\nspawn(process.execPath, ['worker.js']);\nconst prompt = { content: 'go' };\n",
      'b.mjs': "execFileSync('git', ['status']);\nrun('npm', ['test']);\n",
      'kernel.wgsl': '@compute @workgroup_size(1) fn main() {}\n',
      'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint . && node scripts/verify-js-only.js' } }),
      '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - run: npm ci && npm test\n'
    };
    const root = fixture(files);
    expect(checkJsOnly({ root, files: Object.keys(files) })).toEqual([]);
  });

  it('fails a Python or Go file', () => {
    const files = { 'tool.py': 'print(1)\n', 'cmd/main.go': 'package main\n', 'go.mod': 'module x\n', 'requirements.txt': 'numpy\n' };
    const root = fixture(files);
    expect(checkJsOnly({ root, files: Object.keys(files) }).map(row => row.file).sort()).toEqual(['cmd/main.go', 'go.mod', 'requirements.txt', 'tool.py']);
  });

  it('allows only the Flutter app files, and only in apps/mobile/', () => {
    const allowed = ['apps/mobile/app/lib/main.dart', 'apps/mobile/tool/check_boundaries.dart', 'apps/mobile/pubspec.yaml', 'apps/mobile/app/pubspec.yaml',
      'apps/mobile/app/ios/Runner/AppDelegate.swift', 'apps/mobile/app/macos/Flutter/GeneratedPluginRegistrant.swift',
      'apps/mobile/app/ios/Runner/Runner-Bridging-Header.h', 'apps/mobile/app/android/app/src/main/kotlin/id/replo/mobile/MainActivity.kt',
      'apps/mobile/app/android/app/build.gradle.kts', 'apps/mobile/app/android/settings.gradle.kts'];
    const refused = ['tools/x.dart', 'pubspec.yaml', 'apps/poolday/a.swift', 'apps/mobile/app/ios/Runner/native.m', 'apps/mobile/app/lib/helper.kt',
      'apps/mobile/app/ios/Podfile', 'apps/mobile/app/ios/Runner/extra.h', 'native/lib.rs', 'shared/a.c', 'apps/mobile/tool/x.py', 'apps/mobile/go.mod'];
    const files = Object.fromEntries([...allowed, ...refused].map(file => [file, 'x\n']));
    const root = fixture(files);
    expect(checkJsOnly({ root, files: Object.keys(files) }).map(row => row.file).sort()).toEqual([...refused].sort());
  });

  it('fails JavaScript that starts Python or Go', () => {
    expect(findSpawnViolations(`spawn('${PY}', ['-c', 'print(1)']);`)).toHaveLength(1);
    expect(findSpawnViolations(`execFileSync('${GO}', ['build', '-o', out, '.']);`)).toHaveLength(1);
    expect(findSpawnViolations(`const run = promisify(execFile);\nawait run('/usr/bin/${PY}', ['x']);`)).toMatchObject([{ line: 2 }]);
    expect(findSpawnViolations(`execSync('${PY} -m unittest');`)).toHaveLength(1);
    expect(findSpawnViolations(`spawn(process.execPath, ['tool.p' + 'y'])`)).toHaveLength(0);
    expect(findSpawnViolations(`spawn(node, ['requester.p${'y'}'])`)).toHaveLength(1);
    expect(findSpawnViolations(`spawn(config.py${'thon'}.command[0], args)`)).toHaveLength(1);
  });

  it('fails package scripts, workflows and shell scripts that run Python or Go', () => {
    expect(findShellViolations(`${PY} -I harness.py run`)).toHaveLength(1);
    expect(findShellViolations(`npm ci && ${GO} build ./...`)).toHaveLength(1);
    expect(findShellViolations('echo "ready to go" && node x.js')).toHaveLength(0);
    const files = { 'package.json': JSON.stringify({ scripts: { bench: `${PY} bench.py` } }),
      '.github/workflows/ci.yml': `steps:\n  - run: ${GO} test ./...\n`, 'tools/run.sh': `#!/bin/sh\nset -e\n${PY} x\n` };
    const root = fixture(files);
    expect(checkJsOnly({ root, files: Object.keys(files) }).map(row => row.file).sort()).toEqual(['.github/workflows/ci.yml', 'package.json', 'tools/run.sh']);
  });

  it('exits non-zero on a repository with a violation', () => {
    const root = fixture({ 'ok.js': 'export const x = 1;\n', 'bad.js': `import { spawn } from 'node:child_process';\nspawn('${PY}', []);\n` });
    execFileSync('git', ['init', '-q'], { cwd: root });
    const failed = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/bad\.js:2: spawn\(\) starts python3/);
    rmSync(path.join(root, 'bad.js'));
    const passed = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    expect(passed.status).toBe(0);
  });
});
