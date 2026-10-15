// Diagnostic supervisor only. The systemd scope enforces the independent RAM limit.
// Placement C copy of /var/tmp/reploid-recurrent-memory-20261013/cold-reference/observe-native.js
// (sha256 b46b38a5...). Placement C runs two native stages on amd-host, so each needs its own scope
// and inspector port. The only differences: the expected scope name and the inspector port are
// arguments (the original hard-codes reploid-cold-reference-20261013.scope and 127.0.0.1:29992). An optional
// sixth argument replaces the 1,740,000 ms provider deadline (attempt c3 onward: 3,540,000 ms, inside a
// 3,600 s scope cap), because attempt c2 ran past the original deadline during mac-host network stalls.
// Usage: node observe-native-c.js <probe> <config> <receipt> <scope name without .scope> <inspector port> [deadline ms]
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
const [probe, config, receipt, scopeName, inspectorPort, deadlineArg] = process.argv.slice(2);
const deadlineMs = deadlineArg === undefined ? 1740000 : Number(deadlineArg);
if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0 || deadlineMs > 3540000) throw Error('Deadline must be at most 3,540,000 ms');
if (!/^fc-[a-z0-9-]+$/.test(scopeName || '') || !/^299[0-9]{2}$/.test(inspectorPort || '')) throw Error('Scope name and loopback inspector port required');
const cgroup = readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').at(-1);
const append = value => appendFileSync(receipt, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n');
const memory = () => Object.fromEntries(['memory.current', 'memory.peak', 'memory.events'].map(key =>
  [key, readFileSync('/sys/fs/cgroup' + cgroup + '/' + key, 'utf8').trim()]));
if (!cgroup.endsWith('/' + scopeName + '.scope')) throw Error('Unexpected scope');
writeFileSync('/sys/fs/cgroup' + cgroup + '/memory.oom.group', '1');
for (const [key, expected] of Object.entries({ 'memory.high':'10737418240', 'memory.max':'12884901888', 'memory.swap.max':'0', 'memory.oom.group':'1' })) {
  if (readFileSync('/sys/fs/cgroup' + cgroup + '/' + key, 'utf8').trim() !== expected) throw Error('Unenforced ' + key);
}
const child = spawn(process.execPath, ['--inspect=127.0.0.1:' + inspectorPort, probe, config], { stdio: 'inherit' });
append({ phase: 'provider-started', providerPid: child.pid, supervisorPid: process.pid, cgroup, inspectorPort: Number(inspectorPort), deadlineMs });
const monitor = setInterval(() => append({ phase: 'memory', ...memory() }), 1000);
let forced;
const deadline = setTimeout(() => {
  append({ phase: 'deadline', ...memory() });
  child.kill('SIGTERM');
  forced = setTimeout(() => child.kill('SIGKILL'), 5000);
}, deadlineMs);
child.on('exit', (code, signal) => {
  clearInterval(monitor); clearTimeout(deadline); clearTimeout(forced);
  append({ phase: 'provider-exit', code, signal, ...memory(),
    cleanup: 'Read provider events; exit alone does not establish GPU settlement.' });
  process.exitCode = code === 0 ? 0 : 1;
});
child.on('error', error => {
  clearInterval(monitor); clearTimeout(deadline); clearTimeout(forced);
  append({ phase: 'spawn-error', message: error.message }); process.exitCode = 1;
});
