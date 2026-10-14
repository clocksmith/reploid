// Checks that the packaged native participant carries --room-token-file and that its --help
// lists it. New script for final-3. The only process started is the installed participant
// with --help, which prints usage and returns before any identity, module, network or GPU
// work (server/native-participant.js main()). The install directory's file list is
// compared before and after to confirm --help wrote nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [installedRoot, packageDirectory, checkout, commit, output] = process.argv.slice(2);
assert(output, 'Provide installed native package, packaging directory, checkout, commit and receipt path');
const FLAG = '--room-token-file', FILE = 'server/native-participant.js';
const exec = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function listing(root, prefix = '') {
  const rows = [];
  for (const item of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) rows.push(...await listing(root, name));
    else { const stat = await fs.lstat(path.join(root, name)); rows.push(`${name}:${stat.size}:${stat.mtimeMs}`); }
  }
  return rows.sort();
}
const copies = {};
for (const [label, root] of [['installed', installedRoot], ['packaging directory', packageDirectory]]) {
  const bytes = await fs.readFile(path.join(root, FILE));
  copies[label] = { sha256: hash(bytes), flagOccurrences: bytes.toString('utf8').split(FLAG).length - 1 };
}
const blob = hash(Buffer.from((await exec('git', ['show', `${commit}:${FILE}`], { cwd: checkout, encoding: 'buffer', maxBuffer: 1 << 26 })).stdout));
const before = await listing(installedRoot);
let help;
try {
  const run = await exec(process.execPath, [FILE, '--help'], { cwd: installedRoot, timeout: 30000 });
  help = { exitCode: 0, stdout: run.stdout, stderr: run.stderr };
} catch (error) { help = { exitCode: error.code ?? null, signal: error.signal ?? null, stdout: error.stdout, stderr: error.stderr }; }
const after = await listing(installedRoot);
const result = { schema: 'reploid.native-room-token-file-check/v1', flag: FLAG, commit, commitBlobSha256: blob, copies,
  packagedMatchesCommit: Object.values(copies).every(copy => copy.sha256 === blob),
  help: { command: `node ${FILE} --help`, cwd: installedRoot, node: process.version, ...help,
    listsFlag: help.stdout?.includes(FLAG) === true },
  installDirectoryUnchangedByHelp: JSON.stringify(before) === JSON.stringify(after), installDirectoryFiles: before.length,
  GPUOpened: false, networkOpened: false };
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
assert(result.packagedMatchesCommit && Object.values(copies).every(copy => copy.flagOccurrences > 0)
  && help.exitCode === 0 && result.help.listsFlag && result.installDirectoryUnchangedByHelp, 'Room token file check failed');
console.log(`Packaged participant equals ${commit} and contains ${FLAG}; --help exited 0 and lists it`);
