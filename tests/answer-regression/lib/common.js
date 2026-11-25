// Labels, hashing, file and configuration helpers shared by the harness modules.
// Automated regression evaluation — not independent acceptance.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LABEL = 'automated regression evaluation — not independent acceptance';
export const JUDGE_LABEL = 'automated judge, not independent review';
export const SCOPE_NOTE = 'Engineering regression signal only. It compares one run with a stored run of the same target. '
  + 'It establishes no answer quality, no acceptance, no release decision and no independent review; '
  + 'human reviewers assess the working experience separately.';
export const PYTHON_REMOVED = 'python execution removed (JavaScript-only)';

export const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO = path.resolve(HARNESS, '..', '..');

// The useful-answer set and the review packet were retired from the source tree into the
// hash-verified evidence catalog (docs/evidence-catalog). Restore them in place with
// `node scripts/restore-evidence.js <path>`, or into another root named by REPLOID_ARX_EVIDENCE_ROOT.
// Every file read from there is pinned by sha256; records name the canonical repository path.
export const EVIDENCE_ROOT = process.env.REPLOID_ARX_EVIDENCE_ROOT ? path.resolve(process.env.REPLOID_ARX_EVIDENCE_ROOT) : REPO;
export const USEFUL_ANSWER_REL = 'artifacts/useful-answer-set-20261014';
export const USEFUL_ANSWER_DIR = path.join(EVIDENCE_ROOT, USEFUL_ANSWER_REL);
export const USEFUL_ANSWER_SET = path.join(USEFUL_ANSWER_DIR, 'answer-set.json');
export const USEFUL_ANSWER_SET_FILE = `${USEFUL_ANSWER_REL}/answer-set.json`;
export const USEFUL_ANSWER_SET_SHA256 = 'ac174063024054b9ea048b2dd4c532119bea96ae4d330dab89dd2c3ea62dced5';
export const POLICIES = path.join(EVIDENCE_ROOT, 'artifacts', 'independent-answer-review-20261014', 'evaluation-policies.md');
export const POLICIES_SHA256 = '41550353a495f6268ae1a0dffdaf9619af1d0ae0edaab7c3b0241414b19abacb';
export const SEARCH_SET = path.join(HARNESS, 'sets', 'search-tasks.json');
export const SEARCH_SET_SHA256 = '1b0a150ec32d163a7f6036b955e3d040fe4d7f66ebbfcbbc34c442d3851ebe33';
export const OVERLAY = path.join(HARNESS, 'sets', 'useful-answer-overlay.json');
export const OVERLAY_SHA256 = '1419fd8ebbbbd716a5f69c131f4b1cb36b643664a87bf107d34759ed3f8876d3';
export const RETRIEVAL_HELPER = path.join(HARNESS, 'node', 'retrieval-helper.js');
export const RETRIEVAL_COMPONENT = path.join(REPO, 'packages', 'reploid', 'src', 'retrieval');

/** A refusal or failure the command line reports as one message and exit status 1. */
export class HarnessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HarnessError';
  }
}

export const fail = message => { throw new HarnessError(message); };

export const sha256Bytes = data => createHash('sha256').update(data).digest('hex');
export const sha256Text = text => sha256Bytes(Buffer.from(text, 'utf8'));
export const sha256File = file => sha256Bytes(fs.readFileSync(file));

export const loadJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

/** Indented UTF-8 JSON. Exclusive by default: evidence is never overwritten. */
export function writeJson(file, value, exclusive = true) {
  return writeText(file, JSON.stringify(value, null, 1) + '\n', exclusive);
}

export function writeText(file, text, exclusive = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w' });
  return file;
}

export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Repository-relative POSIX path, or null for a path outside the repository (never recorded). */
export function repoRelative(file) {
  if (file === null || file === undefined) return null;
  const relative = path.relative(REPO, realish(file));
  if (relative === '') return '.';
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

function realish(file) {
  const resolved = path.resolve(file);
  try {
    return fs.realpathSync(resolved);
  } catch {
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(realish(parent), path.basename(resolved));
  }
}

export const insideRepo = file => repoRelative(file) !== null;

export function requireOutsideRepo(file, what) {
  if (insideRepo(file)) fail(`${what} must be outside the repository: ${file}`);
}

const ENV_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Expands ${NAME} from the environment. Machine paths stay out of committed configuration and records. */
export function expand(value, environ = process.env) {
  if (typeof value !== 'string') return value;
  return value.replace(ENV_REFERENCE, (_, name) => {
    if (!environ[name]) fail(`Environment variable ${name} is required by the configuration`);
    return environ[name];
  });
}

export function resolvePath(value, base = null, environ = process.env) {
  let expanded = expand(value, environ);
  if (expanded === '~' || expanded.startsWith('~/')) expanded = path.join(os.homedir(), expanded.slice(1));
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(base || REPO, expanded);
}

/** What a record keeps for a configured path: the configured text and the repository path if inside. */
export const describePath = (template, resolved = null) => ({
  configured: template, repositoryPath: resolved !== null ? repoRelative(resolved) : null });

export function gitHead() {
  const done = spawnSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000 });
  return (done.status === 0 && done.stdout.trim()) || null;
}

export function environmentVersions() {
  return { python: null, pythonExecution: PYTHON_REMOVED, node: process.version,
    os: `${os.type()} ${os.release()}`, machine: os.machine() };
}

/** Files under root sorted by path parts, as Python's Path ordering does. */
function listFiles(root) {
  const rows = [];
  const walk = (directory, parts) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const next = [...parts, entry.name];
      if (entry.isDirectory()) walk(full, next);
      else if (entry.isFile() || (entry.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isFile())) rows.push(next);
    }
  };
  walk(root, []);
  return rows.sort(comparePartLists);
}

function comparePartLists(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return comparePython(a[index], b[index]);
  }
  return a.length - b.length;
}

/** Code-point order, as Python compares str. */
export function comparePython(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
    const difference = x[index].codePointAt(0) - y[index].codePointAt(0);
    if (difference) return difference;
  }
  return x.length - y.length;
}

/** sha256 over sorted (relative path, file sha256) pairs; include filters relative paths. */
export function directoryDigest(root, include = null) {
  const rows = [];
  for (const parts of listFiles(root)) {
    const rel = parts.join('/');
    if (include && !include(rel)) continue;
    rows.push(`${rel}\0${sha256File(path.join(root, ...parts))}`);
  }
  return { files: rows.length, sha256: sha256Text(rows.join('\n')) };
}

/** Digest of the retrieval component source the harness ran against (it may change underneath). */
export function retrievalComponentIdentity() {
  return { path: repoRelative(RETRIEVAL_COMPONENT),
    ...directoryDigest(RETRIEVAL_COMPONENT, rel => (rel.endsWith('.js') || rel.endsWith('.json')) && !rel.includes('/')),
    gitHead: gitHead() };
}

/** Frozen inputs change only as a new version with a new pin. */
export function frozenFile(file, pinned, what) {
  if (!fs.existsSync(file)) {
    fail(`The ${what} is missing at ${file}. Restore it with node scripts/restore-evidence.js `
      + `(or set REPLOID_ARX_EVIDENCE_ROOT to a restored root).`);
  }
  if (sha256File(file) !== pinned) fail(`The ${what} changed; it is frozen at sha256 ${pinned}. A change needs a new version and pin.`);
  return loadJson(file);
}

/** The harness code that produced a record: its commit and a digest of its code and frozen inputs. */
export function harnessIdentity() {
  const code = directoryDigest(HARNESS, rel => rel.startsWith('sets/') || (
    ['.py', '.js', '.mjs'].some(suffix => rel.endsWith(suffix)) && !rel.includes('__pycache__') && !rel.startsWith('baselines/')));
  return { path: repoRelative(HARNESS), gitHead: gitHead(), codeAndSets: code, language: 'javascript' };
}

export const labelBlock = () => ({ label: LABEL, scope: SCOPE_NOTE });

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** round(passed / total, 4) as Python computes it: nearest to the double's exact value, exact ties to even. */
export function round4(passed, total) {
  const value = passed / total;
  const scaled = passed * 10000;
  const quotient = Math.floor(scaled / total);
  const remainder = scaled - quotient * total;
  const reduced = total / gcd(passed, total);
  const dyadic = (reduced & (reduced - 1)) === 0;
  if (2 * remainder === total && dyadic) return (quotient % 2 === 0 ? quotient : quotient + 1) / 10000;
  return Number(value.toFixed(4));
}

/** The {pass, total, rate} block the records use. */
export const rateBlock = (passed, total) => ({ pass: passed, total, rate: total ? round4(passed, total) : null });
