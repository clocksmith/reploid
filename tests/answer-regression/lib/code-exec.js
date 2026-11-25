// Executed-code checks: an answer's own JavaScript runs verbatim in a fresh child `node` process, in a scratch
// directory outside the repository, with a timeout, a minimal environment and, where the platform allows, no network
// and no writes outside that directory. A harness probe appended after the code calls the named function.
//
// Reploid is JavaScript only: Python-language cases and reference programs are recorded as not executed
// (pass null), never run. Nothing here repairs, completes or reformats answer code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { PYTHON_REMOVED, fail, requireOutsideRepo } from './common.js';
import { pyEqual, pyJsonDumps, pySplitlines, pyStrip } from './python-compat.js';

export const PROBE_MARK = '__REPLOID_REGRESSION_PROBE__';
export const NOT_EXECUTED = `not executed: ${PYTHON_REMOVED}`;
const TAGS = { python: ['python', 'py', ''], javascript: ['javascript', 'js', ''] };
const OUTPUT_LIMIT = 64 * 1024;
export const FILE_SIZE_LIMIT = 8 * 1024 * 1024;
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

/** Fenced blocks tagged with the language (or untagged); the whole answer if unfenced. */
export function codeOf(output, language) {
  const blocks = [...output.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
  if (!blocks.length) return output;
  return blocks.filter(([, tag]) => TAGS[language].includes(pyStrip(tag).toLowerCase())).map(([, , body]) => body).join('\n');
}

const JS_DECLARATION = /function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
const PY_DECLARATION = /^\s*def\s+([A-Za-z_]\w*)\s*\(/m;

export function firstFunction(code, language) {
  const match = (language === 'python' ? PY_DECLARATION : JS_DECLARATION).exec(code);
  if (!match) return null;
  return language === 'python' ? match[1] : match[1] || match[2];
}

/** The appended JavaScript probe program, kept apart from the answer's code in records. */
export function probeLines(function_, probes) {
  const lines = ['', '// --- appended by the answer regression harness ---'];
  for (const probe of probes) {
    lines.push(`(() => { let __rhText; try { const __rhValue = (${function_})(...${pyJsonDumps(probe.args)}); `
      + '__rhText = JSON.stringify(__rhValue === undefined ? { ok: true, undefined: true } : { ok: true, value: __rhValue }); } '
      + 'catch (__rhError) { __rhText = JSON.stringify({ ok: false, error: String(__rhError && __rhError.name) + ": " '
      + '+ String(__rhError && __rhError.message).slice(0, 200) }); } '
      + `console.log("\\n${PROBE_MARK} " + __rhText); })();`);
  }
  return lines.join('\n') + '\n';
}

function detectIsolation() {
  if (process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC)) {
    return { kind: 'sandbox-exec', network: 'denied', writes: 'case directory only' };
  }
  const probe = spawnSync('unshare', ['--user', '--map-root-user', '--net', 'true'], { stdio: 'ignore' });
  if (probe.status === 0) return { kind: 'unshare', network: 'denied (new network namespace)', writes: 'not restricted' };
  return { kind: 'none', network: 'not isolated', writes: 'not restricted' };
}

const safeName = name => name.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 60);

/** A scratch root outside the repository; each execution gets a fresh empty directory under it. */
export class Sandbox {
  constructor(root = null, timeout = 10) {
    this.owned = root === null || root === undefined;
    const base = this.owned ? fs.mkdtempSync(path.join(os.tmpdir(), 'reploid-answer-regression-')) : path.resolve(root);
    fs.mkdirSync(base, { recursive: true });
    this.root = fs.realpathSync(base);
    requireOutsideRepo(this.root, 'The code-execution scratch directory');
    for (let parent = this.root; ; parent = path.dirname(parent)) {
      if (fs.existsSync(path.join(parent, 'package.json'))) fail(`Code-execution scratch must have no package.json above it: ${parent}`);
      if (path.dirname(parent) === parent) break;
    }
    this.timeout = timeout;
    this.count = 0;
    this.isolation = detectIsolation();
  }

  /** The unit of the shell's `ulimit -f` (512 or 1024 bytes, depending on the shell), measured once. */
  ulimitBlock() {
    if (!this.block) {
      const probe = path.join(this.root, '.ulimit-probe');
      const done = spawnSync('/bin/sh', ['-c', 'ulimit -f 1 && exec "$@"', 'sh', process.execPath, '-e',
        'try { require("fs").writeFileSync(process.argv[1], Buffer.alloc(768)); console.log("1024"); } '
        + 'catch (error) { console.log(error.code === "EFBIG" ? "512" : "unknown"); }', probe], { encoding: 'utf8', timeout: 20000 });
      fs.rmSync(probe, { force: true });
      this.block = Number(done.stdout.trim()) || 512;
    }
    return this.block;
  }

  wrap(command, caseDir) {
    // RLIMIT_FSIZE through the shell's ulimit; Node cannot set rlimits on a child itself.
    const limited = ['/bin/sh', '-c', `ulimit -f ${FILE_SIZE_LIMIT / this.ulimitBlock()} && exec "$@"`, 'sh', ...command];
    if (this.isolation.kind === 'sandbox-exec') {
      const profile = '(version 1)(allow default)(deny network*)(deny file-write*)'
        + `(allow file-write* (subpath "${caseDir}") (literal "/dev/null"))`;
      return [SANDBOX_EXEC, '-p', profile, ...limited];
    }
    if (this.isolation.kind === 'unshare') return ['unshare', '--user', '--map-root-user', '--net', ...limited];
    return limited;
  }

  environment() {
    return { os: process.platform, python: null, pythonExecution: PYTHON_REMOVED, node: process.version,
      timeoutSeconds: this.timeout, isolation: this.isolation,
      environmentVariables: ['PATH', 'HOME (the case directory)'], fileSizeLimitBytes: FILE_SIZE_LIMIT };
  }

  /** A fresh directory for a syntax check (`node --check`; nothing is executed). */
  syntaxDirectory() {
    const caseDir = path.join(this.root, `syntax-${this.count}`);
    this.count += 1;
    fs.mkdirSync(caseDir);
    return caseDir;
  }

  /** Runs a JavaScript program in a fresh case directory. Only JavaScript is ever executed. */
  async run(language, program, name) {
    if (language !== 'javascript') throw new Error(`refusing to execute ${language} code: ${PYTHON_REMOVED}`);
    this.count += 1;
    const caseDir = path.join(this.root, `case-${String(this.count).padStart(3, '0')}-${safeName(name)}`);
    fs.mkdirSync(caseDir);
    const real = fs.realpathSync(caseDir);
    fs.writeFileSync(path.join(real, 'main.js'), program, 'utf8');
    const stdoutPath = path.join(real, '.stdout');
    const stderrPath = path.join(real, '.stderr');
    const out = fs.openSync(stdoutPath, 'w');
    const err = fs.openSync(stderrPath, 'w');
    const [file, ...args] = this.wrap([process.execPath, 'main.js'], real);
    let timedOut = false;
    let exitCode;
    try {
      exitCode = await new Promise((resolve, reject) => {
        const child = spawn(file, args, { cwd: real, stdio: ['ignore', out, err], detached: true,
          env: { PATH: process.env.PATH || '', HOME: real } });
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            child.kill('SIGKILL');
          }
        }, this.timeout * 1000);
        child.on('error', error => {
          clearTimeout(timer);
          reject(error);
        });
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve(timedOut ? null : code ?? (signal ? -os.constants.signals[signal] : null));
        });
      });
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
    const read = file_ => {
      const bytes = fs.readFileSync(file_).subarray(0, OUTPUT_LIMIT);
      return new TextDecoder('utf-8').decode(bytes).replaceAll(real, '<case dir>');
    };
    return { command: 'node main.js', exitCode, timedOut, stdout: read(stdoutPath),
      stderrTail: pySplitlines(pyStrip(read(stderrPath))).slice(-3) };
  }

  close() {
    if (this.owned) fs.rmSync(this.root, { recursive: true, force: true });
  }
}

export function sameValue(actual, expected) {
  if (typeof expected === 'boolean' || typeof actual === 'boolean') {
    return typeof actual === 'boolean' && typeof expected === 'boolean' ? actual === expected : false;
  }
  if (typeof expected === 'number' && typeof actual === 'number') return actual === expected;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    return actual.length === expected.length && actual.every((value, index) => sameValue(value, expected[index]));
  }
  return pyEqual(actual, expected);
}

export function parseProbes(stdout) {
  const rows = [];
  for (const line of pySplitlines(stdout)) {
    if (!line.startsWith(`${PROBE_MARK} `)) continue;
    try {
      rows.push(JSON.parse(line.slice(PROBE_MARK.length + 1)));
    } catch {
      rows.push({ ok: false, error: 'unparseable probe output' });
    }
  }
  return rows;
}

/** One overlay case against one answer: the execution record and per-probe verdicts. */
export async function runCase(sandbox, case_, output) {
  const record = { item: case_.item, turn: case_.turn, language: case_.language };
  if (case_.language !== 'javascript') {
    // Recorded, not run, not graded: a pass of null leaves the code family to the JavaScript cases.
    return { ...record, function: case_.function ?? null, functionFromAnswer: case_.function === null || case_.function === undefined,
      pass: null, executed: false, reason: NOT_EXECUTED, probes: [] };
  }
  const code = codeOf(output, case_.language);
  const function_ = case_.function || firstFunction(code, case_.language);
  Object.assign(record, { function: function_, functionFromAnswer: case_.function === null || case_.function === undefined });
  if (!pyStrip(code)) return { ...record, pass: false, reason: 'no code in the answer for this language', probes: [] };
  if (!function_) return { ...record, pass: false, reason: 'no function declaration found', probes: [] };
  const appended = probeLines(function_, case_.probes);
  const result = await sandbox.run(case_.language, `${code}\n${appended}`, `${case_.item}-t${case_.turn}`);
  const observed = parseProbes(result.stdout);
  const probes = case_.probes.map((probe, index) => {
    const seen = index < observed.length ? observed[index] : null;
    const ok = Boolean(seen && seen.ok && 'value' in seen && sameValue(seen.value, probe.expect));
    return { args: probe.args, expect: probe.expect, observed: seen, pass: ok };
  });
  let reason = null;
  if (result.timedOut) reason = 'timed out';
  else if (observed.length < case_.probes.length) reason = 'the code stopped before every probe ran';
  else if (!probes.every(probe => probe.pass)) reason = 'a probe returned a different value or raised';
  return { ...record, pass: reason === null, reason, probes, program: { answerCode: code, appendedByHarness: appended },
    execution: result };
}

export async function runReference(sandbox, reference) {
  const row = { item: reference.item, language: reference.language, program: reference.program,
    expectStdout: reference.expectStdout };
  if (reference.language !== 'javascript') return { ...row, execution: null, executed: false, reason: NOT_EXECUTED, pass: null };
  const result = await sandbox.run(reference.language, `${reference.program}\n`, `reference-${reference.item}`);
  return { ...row, execution: result, pass: result.exitCode === 0 && result.stdout === reference.expectStdout };
}
