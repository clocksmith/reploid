/**
 * How the operator machine reaches a host agent. The physical adapter takes a transport as an argument: only the CLI
 * constructs the SSH one, so a test cannot reach a real machine by leaving something out.
 */
import { spawn as spawnProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

/**
 * The command line a host's SSH server receives. A POSIX host gets each argument in single quotes. Windows OpenSSH
 * hands the line to cmd.exe or PowerShell, and both keep single quotes as part of the word, so a host with
 * `platform: 'windows'` gets the arguments with no quoting at all, and each must need none in either shell. The
 * host file's Windows path rule (physical-config.js) keeps paths inside that set.
 * Not yet run against a real Windows host: how its SSH server passes the line to the shell is still to be seen there.
 */
const WINDOWS_PLAIN = /^[A-Za-z0-9_.:\\/-]+$/;
export function remoteCommand(target, argv) {
  if (target.platform !== 'windows') return argv.map(shellQuote).join(' ');
  if (!argv.every(value => typeof value === 'string' && WINDOWS_PLAIN.test(value))) throw new TypeError('A Windows host command argument would need quoting');
  return argv.join(' ');
}

/** Credentials travel on standard input, so they never appear in a process list on either machine. */
export function sshArguments(target, argv, { connectTimeoutSeconds = 15 } = {}) {
  return ['-T', '-o', 'BatchMode=yes', '-o', `ConnectTimeout=${connectTimeoutSeconds}`, '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3', '--', target.ssh, remoteCommand(target, argv)];
}

export function createSshTransport({ spawn = spawnProcess } = {}) {
  const start = (target, argv) => (target.ssh === null
    ? spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn('ssh', sshArguments(target, argv), { stdio: ['pipe', 'pipe', 'pipe'] }));
  return Object.freeze({
    open: start,
    run(target, argv, { input = '', timeoutMs, signal } = {}) {
      return new Promise((resolve, reject) => {
        const child = start(target, argv);
        let stdout = '', stderr = '', settled = false;
        const finish = (done, value) => {
          if (settled) return;
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
          done(value);
        };
        const abort = () => { child.kill('SIGKILL'); finish(reject, signal.reason ?? Error('Host command stopped')); };
        const timer = setTimeout(() => { child.kill('SIGKILL'); finish(reject, Error('Host command timed out')); }, timeoutMs);
        if (signal?.aborted) { abort(); return; }
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', chunk => { stdout += chunk; });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
        child.on('error', error => finish(reject, error));
        child.on('close', code => finish(resolve, { code, stdout, stderr }));
        child.stdin.on('error', () => {});
        child.stdin.end(input);
      });
    }
  });
}

/** The last JSON line of a one-shot agent command. */
export function parseControlReply(stdout) {
  const line = String(stdout).trim().split('\n').at(-1);
  try { return JSON.parse(line); } catch { return null; }
}

/** A long-lived agent over JSON lines. Closing its standard input ends it, so a lost connection cannot strand GPU work. */
export function openAgentSession(child, { helloTimeoutMs = 60000, defaultTimeoutMs = 600000 } = {}) {
  const pending = new Map();
  const session = { child, exited: false, pid: null, startId: null, harnessDigest: null };
  let helloDone, helloFail;
  session.hello = new Promise((resolve, reject) => { helloDone = resolve; helloFail = reject; });
  session.hello.catch(() => {});
  const helloTimer = setTimeout(() => helloFail(Error('Host agent did not start')), helloTimeoutMs);
  helloTimer.unref?.();
  createInterface({ input: child.stdout }).on('line', line => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.event === 'agent') {
      Object.assign(session, { pid: value.pid, startId: value.startId, harnessDigest: value.harnessDigest });
      clearTimeout(helloTimer); helloDone(session);
      return;
    }
    const waiting = pending.get(value.id);
    if (!waiting) return;
    pending.delete(value.id); clearTimeout(waiting.timer);
    if (value.error) waiting.reject(Object.assign(Error(value.error), { code: value.code })); else waiting.resolve(value.result);
  });
  child.stderr?.on('data', () => {});
  child.stdin.on('error', () => {});
  const ended = () => {
    if (session.exited) return;
    session.exited = true; clearTimeout(helloTimer);
    helloFail(Error('Host agent exited before it started'));
    for (const waiting of pending.values()) { clearTimeout(waiting.timer); waiting.reject(Error('Host agent exited')); }
    pending.clear();
  };
  child.on('exit', ended); child.on('error', ended);
  session.call = (op, body = {}, { timeoutMs = defaultTimeoutMs } = {}) => new Promise((resolve, reject) => {
    if (session.exited) { reject(Error('Host agent has exited')); return; }
    const id = randomUUID(), timer = setTimeout(() => { pending.delete(id); reject(Error(`Host agent ${op} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, op, body }) + '\n');
  });
  session.end = () => { try { child.stdin.end(); } catch { /* already closed */ } };
  return session;
}
