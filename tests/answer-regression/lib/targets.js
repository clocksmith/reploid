// Answer targets behind one interface.
//
// Every target takes a plan (items with the exact user content to send per turn) and returns run items whose turns
// carry the same fields, so the same checks and comparisons apply to all of them:
//
//   cpu-q4k-control         The useful-answer set's CPU Q4_K control. It ran a frozen Python script (run-arm.py), so
//                           under the JavaScript-only order it refuses to generate; its stored runs stay comparable.
//   doppler-single-machine  Doppler's own Node/Dawn pipeline for a given package and model on one host (node/doppler-run.mjs).
//   installed-route         An installed native participant's opt-in text HTTP API (chat request API).
//
// Each target records the identities it ran with: package or archive hash, model manifest, Capsule, route or placement,
// prompts, sampling and limits. Configured machine paths come from ${ENV} references and are never written into
// records; records keep the configured text, hashes and identifiers.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HARNESS, describePath, expand, fail, loadJson, repoRelative, requireOutsideRepo, resolvePath, sha256File, sha256Text,
  writeJson } from './common.js';

export const DOPPLER_RUNNER = path.join(HARNESS, 'node', 'doppler-run.mjs');
export const TARGET_SCHEMA = 'reploid.answer-regression.target/v1';
export const CPU_CONTROL_REFUSAL = 'target (a) ran a Python control; removed under the JavaScript-only order. '
  + 'Its stored baseline (baselines/cpu-q4k-mac-20261015) still evaluates, compares and reproduces; generate new runs on '
  + 'target (b) doppler-single-machine or (c) installed-route.';
const TURN_FIELDS = ['turn', 'messages', 'userTyped', 'renderedPromptSha256', 'promptTokenIds', 'promptTokenCount', 'overPromptLimit',
  'output', 'outputTokenIds', 'stopReason', 'decodeSteps', 'seconds', 'minMarginTop1Top2', 'minMarginStep',
  'reusedFrom', 'retrieval', 'dispatched', 'unsupported', 'error', 'responseModel'];

export function turnRow(fields) {
  const unknown = Object.keys(fields).filter(key => !TURN_FIELDS.includes(key));
  if (unknown.length) throw new Error(`unknown turn fields ${JSON.stringify(unknown.sort())}`);
  return Object.fromEntries(TURN_FIELDS.map(key => [key, fields[key] === undefined ? null : fields[key]]));
}

function catalogEntry(catalogPath, modelId) {
  const entry = loadJson(catalogPath).find(model => model.id === modelId);
  if (!entry) fail(`model ${modelId} is not in the configured catalog`);
  return entry;
}

/** json.dumps(value, sort_keys=True, separators=(',', ':')) for JSON values (ASCII-escaped, as Python writes it). */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${canonicalJson(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'string') {
    return JSON.stringify(value).replace(/[\x7f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  }
  return JSON.stringify(value);
}

function entryIdentity(entry, catalogPath, configured) {
  const capsule = entry.capsule || {};
  return { catalog: { ...describePath(configured, catalogPath), sha256: sha256File(catalogPath), entrySha256: sha256Text(canonicalJson(entry)) },
    modelId: entry.id, manifestIdentity: entry.identity ?? null, capsuleId: capsule.capsuleId ?? null,
    targetPlanCount: (capsule.targetPlans || []).length, generation: entry.generation ?? null };
}

/** shlex.quote. */
export const shellQuote = value => {
  const text = String(value);
  if (!text) return "''";
  if (/^[\w@%+=:,./-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", `'"'"'`)}'`;
};

class Target {
  static kind = null;

  constructor(config, file, environ = process.env) {
    this.config = config;
    this.path = file;
    this.environ = environ;
    this.id = config.id;
    this.routeLimit = config.routePromptTokenLimit ?? null;
  }

  get kind() {
    return this.constructor.kind;
  }

  pathOf(key, section = 'paths') {
    const template = this.config[section][key];
    return [template, resolvePath(template, null, this.environ)];
  }

  describe() {
    return { id: this.id, kind: this.kind, host: this.config.host ?? null, description: this.config.description ?? null,
      configFile: repoRelative(this.path), configSha256: sha256File(this.path), routePromptTokenLimit: this.routeLimit };
  }

  supportsSearch() {
    return [true, null];
  }

  overLimit(count) {
    return this.routeLimit !== null && count !== null && count !== undefined && count > this.routeLimit;
  }
}

// ---- (a) CPU Q4_K control (removed) --------------------------------------------------------------

export class CpuQ4kControl extends Target {
  static kind = 'cpu-q4k-control';

  async generate() {
    fail(CPU_CONTROL_REFUSAL);
  }
}

/**
 * Maps run-arm.py's per-turn rows (the stored arm runs of the useful-answer set) onto the harness turn fields. Without a
 * plan (an imported arm run), each run turn's own last user message is the typed content.
 */
export function armRunItems(raw, targetId, routeLimit, plan = null) {
  const overLimit = count => routeLimit !== null && routeLimit !== undefined && count !== null && count !== undefined && count > routeLimit;
  const byId = new Map(raw.items.map(item => [item.id, item]));
  plan = plan ?? { items: raw.items.map(item => ({ id: item.id, category: item.category,
    turns: item.turns.map(turn => ({ user: turn.messages.at(-1).content, dispatch: true, retrieval: null })) })) };
  return plan.items.map(item => {
    const rawTurns = (byId.get(item.id) || { turns: [] }).turns;
    const turns = [];
    for (const [index, planned] of item.turns.entries()) {
      if (!planned.dispatch) {
        turns.push(turnRow({ turn: index + 1, userTyped: planned.user, retrieval: planned.retrieval, dispatched: false, overPromptLimit: false }));
        break;
      }
      if (index >= rawTurns.length) break;
      const row = rawTurns[index];
      turns.push(turnRow({ turn: row.turn, messages: row.messages, userTyped: planned.user,
        renderedPromptSha256: sha256Text(row.renderedPrompt), promptTokenIds: row.promptTokenIds,
        promptTokenCount: row.promptTokenCount, overPromptLimit: overLimit(row.promptTokenCount),
        output: row.output, outputTokenIds: row.outputTokenIds, stopReason: row.stopReason,
        decodeSteps: row.decodeSteps, seconds: row.seconds, minMarginTop1Top2: row.minMarginTop1Top2,
        minMarginStep: row.minMarginStep ?? null, reusedFrom: row.reusedFrom ?? null,
        retrieval: planned.retrieval, dispatched: true }));
    }
    return { id: item.id, category: item.category ?? null, arm: targetId, turns };
  });
}

/** Extracts a Doppler .tgz into destination with the system tar; returns the package root. */
export function extractArchive(archive, destination) {
  fs.mkdirSync(destination, { recursive: false });
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (listing.status !== 0) fail(`could not read the Doppler archive: ${(listing.stderr || '').trim().slice(-300)}`);
  for (const name of listing.stdout.split('\n').filter(Boolean)) {
    if (path.isAbsolute(name) || name.split('/').includes('..')) fail(`The Doppler archive has an unsafe member: ${name}`);
  }
  const done = spawnSync('tar', ['-xzf', archive, '-C', destination, '--no-same-owner'], { encoding: 'utf8' });
  if (done.status !== 0) fail(`could not extract the Doppler archive: ${(done.stderr || '').trim().slice(-300)}`);
  const root = path.join(destination, 'package');
  if (!fs.existsSync(path.join(root, 'package.json'))) fail('The Doppler archive has no package/package.json');
  return root;
}

// ---- (b) Doppler single machine (Node/Dawn) -------------------------------------------------------

/**
 * Doppler's own pipeline for one package and model on one host, through node/doppler-run.mjs.
 *
 * host 'local' runs here; any other value is an SSH alias resolved by the operator's own SSH configuration.
 * Only the runner, the plan and the small result file cross the connection; logs stay on the host.
 */
export class DopplerSingleMachine extends Target {
  static kind = 'doppler-single-machine';

  remote(key) {
    return expand(this.config.remote[key], this.environ);
  }

  shell(command, timeoutSeconds) {
    const host = this.config.host;
    const [file, args] = host === 'local' ? ['sh', ['-c', command]] : ['ssh', ['-o', 'BatchMode=yes', host, command]];
    const done = spawnSync(file, args, { encoding: 'utf8', timeout: timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024 });
    return { returncode: done.status, stdout: done.stdout || '', stderr: done.stderr || String(done.error || '') };
  }

  copy(source, destination, upload = true) {
    const host = this.config.host;
    if (host === 'local') {
      fs.copyFileSync(source, destination);
      return;
    }
    const pair = upload ? [source, `${host}:${destination}`] : [`${host}:${source}`, destination];
    const done = spawnSync('scp', ['-q', '-o', 'BatchMode=yes', ...pair], { encoding: 'utf8', timeout: 600000 });
    if (done.status !== 0) fail(`scp failed: ${(done.stderr || '').trim().slice(-300)}`);
  }

  async generate(plan, work, log, { preflight = false } = {}) {
    requireOutsideRepo(work, 'The work directory');
    const placement = this.config.placement ?? 'unsplit';
    if (!['unsplit', 'ordered-three-stage'].includes(placement)) fail('placement must be unsplit or ordered-three-stage');
    const runnerPlan = { schema: 'reploid.answer-regression.doppler-plan/v1', setKind: plan.setKind,
      items: plan.items.map(item => ({ id: item.id, category: item.category,
        turns: item.turns.map(turn => ({ send: turn.send, dispatch: turn.dispatch })) })) };
    const planPath = writeJson(path.join(work, 'doppler-plan.json'), runnerPlan);
    const runDir = `${this.remote('workDir').replace(/\/+$/, '')}/${path.basename(work)}`;
    const mkdir = this.shell(`mkdir -p ${shellQuote(runDir)}`, 60);
    if (mkdir.returncode !== 0) fail(`could not create the run directory on ${this.config.host}: ${mkdir.stderr.trim().slice(-300)}`);
    this.copy(DOPPLER_RUNNER, `${runDir}/doppler-run.mjs`);
    this.copy(planPath, `${runDir}/plan.json`);
    const env = Object.entries(this.config.remote.env || {})
      .map(([name, value]) => `${name}=${shellQuote(expand(value, this.environ))}`).join(' ');
    const args = ['--package-root', this.remote('packageRoot'), '--capsule', this.remote('capsuleDir'),
      '--catalog', this.remote('catalog'), '--policy', this.remote('partitionPolicy'),
      '--model-id', this.config.modelId, '--placement', placement, '--plan', 'plan.json', '--out', 'out.json',
      '--host-label', this.config.hostLabel ?? this.config.host];
    if (this.config.remote.packageArchive) args.push('--archive', this.remote('packageArchive'));
    if (preflight) args.push('--preflight');
    const node = expand(this.config.remote.node ?? 'node', this.environ);
    const command = `cd ${shellQuote(runDir)} && ${env} ${shellQuote(node)} doppler-run.mjs ${args.map(shellQuote).join(' ')} > run.log 2>&1`;
    log(`running Doppler on ${this.config.host} (${placement}${preflight ? ', preflight' : ''})`);
    const done = this.shell(command, this.config.timeoutSeconds ?? 14400);
    if (done.returncode !== 0) {
      const tail = this.shell(`tail -n 20 ${shellQuote(runDir)}/run.log`, 60).stdout;
      fail(`doppler-run.mjs failed on ${this.config.host} (log kept there: ${runDir}/run.log):\n${tail}`);
    }
    this.copy(`${runDir}/out.json`, path.join(work, 'doppler-out.json'), false);
    const raw = loadJson(path.join(work, 'doppler-out.json'));
    if (preflight) return [[], raw.identities, { preflight: raw.preflight ?? null, runnerSha256: sha256File(DOPPLER_RUNNER) }];
    const rawItems = new Map(raw.items.map(item => [item.id, item]));
    const items = plan.items.map(item => {
      const got = (rawItems.get(item.id) || { turns: [] }).turns;
      const turns = [];
      for (const [index, planned] of item.turns.entries()) {
        if (!planned.dispatch) {
          turns.push(turnRow({ turn: index + 1, userTyped: planned.user, retrieval: planned.retrieval, dispatched: false,
            overPromptLimit: false, unsupported: planned.unsupported ?? null }));
          break;
        }
        if (index >= got.length) break;
        const row = got[index];
        turns.push(turnRow({ turn: index + 1, messages: row.messages, userTyped: planned.user,
          renderedPromptSha256: row.renderedPromptSha256 ?? null, promptTokenIds: row.promptTokenIds,
          promptTokenCount: row.promptTokenCount, overPromptLimit: this.overLimit(row.promptTokenCount),
          output: row.output, outputTokenIds: row.outputTokenIds, stopReason: row.stopReason,
          decodeSteps: row.decodeSteps, seconds: row.seconds, minMarginTop1Top2: row.minMarginTop1Top2 ?? null,
          minMarginStep: row.minMarginStep ?? null, reusedFrom: row.reusedFrom ?? null, retrieval: planned.retrieval,
          dispatched: true }));
      }
      return { id: item.id, category: item.category, arm: this.id, turns };
    });
    const identities = raw.identities;
    identities.limits.routePromptTokenLimit = this.routeLimit;
    identities.runner = { file: repoRelative(DOPPLER_RUNNER), sha256: sha256File(DOPPLER_RUNNER) };
    return [items, identities, { gpu: raw.gpu ?? null, seconds: raw.seconds ?? null, remoteRunDirectory: 'kept on the host; not recorded' }];
  }
}

// ---- (c) installed route through the chat request API ---------------------------------------------

/**
 * An installed native participant's mounted text API (docs/native-participant.md, 'Opt-in text HTTP APIs').
 *
 * The API takes no sampling overrides: the route's prepared generation policy applies and is recorded from the
 * installed catalog. Credentials come from an environment variable named in the configuration.
 */
export class InstalledRoute extends Target {
  static kind = 'installed-route';

  supportsSearch() {
    if (this.config.retrieval === true) return [true, null];
    return [false, 'The installed chat request API has no retrieval opt-in yet; search items are not sent.'];
  }

  endpoint() {
    return { 'chat-completions': '/v1/chat/completions', messages: '/v1/messages' }[this.config.protocol];
  }

  async post(body) {
    const url = expand(this.config.baseUrl, this.environ).replace(/\/+$/, '') + this.endpoint();
    const headers = { 'content-type': 'application/json' };
    const auth = this.config.auth || {};
    if (auth.env) {
      const secret = process.env[auth.env];
      if (!secret) fail(`Environment variable ${auth.env} is required for the installed route`);
      headers[auth.header ?? 'authorization'] = (auth.prefix ?? 'Bearer ') + secret;
    }
    const started = performance.now();
    const seconds = () => (performance.now() - started) / 1000;
    try {
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body),
        signal: AbortSignal.timeout((this.config.timeoutSeconds ?? 600) * 1000) });
      if (!response.ok) {
        const text = new TextDecoder().decode((await response.arrayBuffer()).slice(0, 300));
        return [null, seconds(), `HTTP ${response.status}: ${text}`];
      }
      return [await response.json(), seconds(), null];
    } catch (error) {
      return [null, seconds(), `${error.name}: ${error.cause?.message || error.message}`];
    }
  }

  async ask(messages) {
    const model = this.config.modelId;
    if (this.config.protocol === 'chat-completions') {
      const [reply, seconds, error] = await this.post({ model, messages, stream: false });
      if (error) return { error, seconds };
      const choice = reply.choices[0];
      const reason = { stop: 'stop', length: 'max-tokens' }[choice.finish_reason] ?? choice.finish_reason ?? null;
      return { output: choice.message.content || '', stopReason: reason, seconds, responseModel: reply.model ?? null };
    }
    const [reply, seconds, error] = await this.post({ model, messages, max_tokens: this.config.maxTokens, stream: false });
    if (error) return { error, seconds };
    const text = (reply.content || []).filter(block => block.type === 'text').map(block => block.text || '').join('');
    const reason = { end_turn: 'stop', max_tokens: 'max-tokens' }[reply.stop_reason] ?? reply.stop_reason ?? null;
    const usage = reply.usage || {};
    return { output: text, stopReason: reason, seconds, responseModel: reply.model ?? null,
      promptTokenCount: usage.input_tokens ?? null, decodeSteps: usage.output_tokens ?? null };
  }

  async generate(plan, work, log) {
    const items = [];
    for (const item of plan.items) {
      let messages = [];
      const turns = [];
      for (const [index, planned] of item.turns.entries()) {
        if (!planned.dispatch) {
          turns.push(turnRow({ turn: index + 1, userTyped: planned.user, retrieval: planned.retrieval, dispatched: false,
            overPromptLimit: false, unsupported: planned.unsupported ?? null }));
          break;
        }
        messages = [...messages, { role: 'user', content: planned.send }];
        const answer = await this.ask(messages);
        const count = answer.promptTokenCount ?? null;
        turns.push(turnRow({ turn: index + 1, messages, userTyped: planned.user, promptTokenCount: count,
          overPromptLimit: this.overLimit(count), output: answer.output ?? '', stopReason: answer.stopReason ?? null,
          decodeSteps: answer.decodeSteps ?? null, seconds: Math.round(answer.seconds * 100) / 100, retrieval: planned.retrieval,
          dispatched: true, error: answer.error ?? null, responseModel: answer.responseModel ?? null }));
        log(`${item.id} turn ${index + 1}: ${answer.stopReason || answer.error}`);
        if (index + 1 < item.turns.length) {
          if (!(answer.output || '').trim()) break;
          messages = [...messages, { role: 'assistant', content: answer.output }];
        }
      }
      items.push({ id: item.id, category: item.category, arm: this.id, turns });
    }
    return [items, this.identities(), {}];
  }

  identities() {
    const [appTemplate, app] = this.pathOf('installedApp');
    const catalog = path.join(app, 'self', 'config', 'chat-models.json');
    const entry = catalogEntry(catalog, this.config.modelId);
    const pinPath = path.join(app, 'self', 'config', 'doppler-package.json');
    const pin = fs.existsSync(pinPath) ? loadJson(pinPath) : null;
    let archive = null;
    if (pin && typeof pin.spec === 'string' && pin.spec.startsWith('file:')) {
      const candidate = path.join(app, pin.spec.slice(5));
      archive = { spec: pin.spec, sha256: fs.existsSync(candidate) ? sha256File(candidate) : null };
    }
    const policy = path.join(app, 'self', 'config', 'partition-policy.json');
    return {
      package: { pin, archive, installedApp: describePath(appTemplate, app) },
      model: { catalogId: entry.id, manifestIdentity: entry.identity ?? null },
      capsule: entryIdentity(entry, catalog, `${appTemplate}/self/config/chat-models.json`),
      route: { protocol: this.config.protocol, endpoint: this.endpoint(), baseUrl: { configured: this.config.baseUrl },
        declaredPlacement: this.config.declaredPlacement ?? null,
        placementSource: 'declared by the operator in the target configuration; the API does not report it' },
      sampling: { source: 'installed catalog generation; the API accepts no sampling overrides', ...(entry.generation || {}) },
      limits: { maxTokens: this.config.maxTokens || (entry.generation || {}).maxTokens || null, routePromptTokenLimit: this.routeLimit,
        partitionPolicySha256: fs.existsSync(policy) ? sha256File(policy) : null },
      tokenIds: 'not reported by this API; answers compare by text',
    };
  }
}

const KINDS = { 'cpu-q4k-control': CpuQ4kControl, 'doppler-single-machine': DopplerSingleMachine, 'installed-route': InstalledRoute };

export function loadTarget(file, environ = process.env) {
  const resolved = path.resolve(file);
  const config = loadJson(resolved);
  if (config.schema !== TARGET_SCHEMA) fail(`${resolved}: schema must be ${TARGET_SCHEMA}`);
  const Kind = KINDS[config.kind];
  if (!Kind) fail(`${resolved}: kind must be one of ${JSON.stringify(Object.keys(KINDS).sort())}`);
  return new Kind(config, resolved, environ);
}
