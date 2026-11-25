#!/usr/bin/env node
/**
 * Runs and judges one Stage 1 split receipt.
 *
 *   node scripts/stage1/run.js --adapter local --work DIRECTORY --out RECEIPT.json [--fixture FILE]
 *   node scripts/stage1/run.js --adapter physical --hosts PRIVATE_FILE --window-until ISO_TIME --work DIRECTORY
 *     --out RECEIPT.json [--fixture FILE]
 *   node scripts/stage1/run.js --adapter physical --hosts PRIVATE_FILE --prepare-stage-directories build|verify
 *     [--host host-a|host-b|requester] [--hash] [--timeout-minutes N]
 *   node scripts/stage1/run.js --adapter physical --hosts PRIVATE_FILE --prepare-stage-directories check --out RECEIPT.json
 *     [--timeout-minutes N]
 *
 * `--prepare-stage-directories` runs before a window, never inside one: `build` writes each stage host's stage
 * directory from its full copy (refusing one that exists), `verify` checks an existing one's build record against
 * the pin. `verify --hash` also re-reads every range, and then hashes every weight directory each machine's searches
 * cover (each stage directory, each host's other weight roots apart from its full copy, the requester's roots) and keeps
 * their fingerprints on that machine. A window run needs those fingerprints: its searches hash only what changed since.
 * Preflight always checks each stage directory's build record against the pin.
 *
 * `check` is the window's own compare, run without a window and read-only: on host-a, host-b and the requester it runs
 * the same searches with `baseline: 'compare'` and each stage directory's build-record check, one timed step at a time.
 * It hashes only a directory that changed since the baseline, never writes one, and writes a receipt of each machine's
 * scan time, directories compared and re-hashed (and why), whether everything matched the baseline, when that baseline
 * was recorded, and the release and harness digest it runs. It fails if a baseline is missing, recorded for other
 * roots, skips, scope or ranges, older than the release of the scan code (`WEIGHT_SCAN_RELEASE`), or no longer matched.
 *
 * Progress goes to standard error, one line per phase and step with UTC times and durations.
 *
 * The local adapter is three processes on this machine with a fake model runtime. The physical adapter drives real
 * hosts over SSH and refuses to start without a window. The written file holds the receipt and the checker's verdict;
 * exit status 0 means the checker passed.
 */
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadStage1Expectations } from './expectations.js';
import { checkStage1Receipt } from './receipt-check.js';
import { runStage1Phases } from './runner.js';
import { createLocalStage1Adapter } from './local-adapter.js';
import { createPhysicalStage1Adapter, WEIGHT_SCAN_RELEASE } from './physical-adapter.js';
import { harnessDigest, readReleaseSha } from './host-agent.js';
import { assertLongReference, createRedactor, loadPhysicalConfig, resolveRunWindow, validatePhysicalConfig } from './physical-config.js';
import { createSshTransport } from './command-transport.js';

const loadWorkload = async (runtimeClass, fixtureFile, creditWeights) => {
  const loaded = await loadStage1Expectations({ runtimeClass, ...(fixtureFile ? { fixtureFile } : {}), ...(creditWeights ? { creditWeights } : {}) });
  if (fixtureFile) assertLongReference(loaded.fixture);
  return loaded;
};

/** Runs the phases on the local adapter and returns `{ receipt, verdict }`. */
export async function runLocalStage1({ directory, limits, signal, fixtureFile = null }) {
  const loaded = await loadWorkload('fake-runtime', fixtureFile);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const adapter = createLocalStage1Adapter({ directory, ...loaded });
  const receipt = await runStage1Phases({ adapter, expectations: loaded.expectations, limits, signal });
  return { receipt, verdict: checkStage1Receipt(receipt, loaded.expectations), expectations: loaded.expectations };
}

/**
 * Runs the phases on real hosts through `transport`, which the caller must supply. The window is checked before
 * anything is contacted, and everything returned has the host file's private values removed.
 */
export async function runPhysicalStage1({ config, transport, windowUntil, directory, fixtureFile = null,
  signal = null, now = Date.now, startCoordinator, verifyStageDirectories = true, log = null }) {
  validatePhysicalConfig(config);
  const { maxRunMs } = resolveRunWindow(windowUntil, { now: now(), stopMarginMs: config.limits.stopMarginMs });
  const loaded = await loadWorkload('physical', fixtureFile, config.credit.weights);
  const redactor = createRedactor(config);
  const adapter = createPhysicalStage1Adapter({ config, directory, transport, redactor, ...loaded, verifyStageDirectories, log, now,
    ...(startCoordinator ? { startCoordinator } : {}) });
  const { phaseMs, abortGraceMs, hardStopMs } = config.limits;
  const raw = await runStage1Phases({ adapter, expectations: loaded.expectations, signal, now, log: log && (line => log(redactor.text(line))),
    limits: { maxRunMs, phaseMs, abortGraceMs, hardStopMs } });
  const receipt = redactor.receipt(raw);
  return { receipt, verdict: checkStage1Receipt(receipt, loaded.expectations), expectations: loaded.expectations };
}

/**
 * Builds or verifies the stage directories on the stage hosts, one host at a time, outside any window. Returns each
 * host's counts and digest, or its refusal, with the host file's private values removed. `verify` with `hash` then
 * records the weight fingerprints a window run compares against (`weights`), for each host whose directory verified
 * and for the requester; `labels` may name `requester` alone.
 */
export async function prepareStageDirectories({ config, transport, action, labels = null, hash = false, timeoutMs, signal = null, log = null }) {
  validatePhysicalConfig(config);
  if (!['build', 'verify'].includes(action)) throw Error('The stage directory action is build or verify');
  const loaded = await loadWorkload('physical', null, config.credit.weights);
  const redactor = createRedactor(config);
  const adapter = createPhysicalStage1Adapter({ config, directory: null, transport, redactor, ...loaded, log });
  const results = {};
  for (const host of config.hosts) {
    if (labels && !labels.includes(host.label)) continue;
    const started = Date.now();
    log?.(`${new Date().toISOString()} prepare ${host.label} stage directory ${action}${hash ? ' --hash' : ''} start`);
    try { results[host.label] = { ok: true, ...await adapter.stageDirectory(host.label, { action, hash, timeoutMs, signal }) }; }
    catch (error) { results[host.label] = { ok: false, code: error.code ?? null, error: redactor.text(error.message) }; }
    log?.(`${new Date().toISOString()} prepare ${host.label} stage directory ${results[host.label].ok ? 'done' : 'failed'} after ${Date.now() - started} ms`);
  }
  if (action === 'verify' && hash) {
    const verified = config.hosts.map(host => host.label).filter(label => results[label]?.ok);
    const wanted = labels ? labels.filter(label => label === 'requester' || verified.includes(label)) : [...verified, 'requester'];
    if (wanted.length) results.weights = await adapter.recordWeightBaselines({ labels: wanted, timeoutMs, signal });
  }
  return results;
}

export const WEIGHT_CHECK_SCHEMA = 'reploid.stage1-weight-check/v1';

/**
 * The `check` action: the window's compare-only weight searches and build-record checks, outside any window, with a
 * receipt. `release` is this operator's `{ sha, harnessDigest }`; every machine must run the same. Nothing is written
 * on any machine. The receipt has the host file's private values removed.
 */
export async function checkStageDirectories({ config, transport, release, timeoutMs, signal = null, log = null, now = Date.now,
  notBefore = WEIGHT_SCAN_RELEASE.committedAt }) {
  validatePhysicalConfig(config);
  const loaded = await loadWorkload('physical', null, config.credit.weights);
  const redactor = createRedactor(config);
  const adapter = createPhysicalStage1Adapter({ config, directory: null, transport, redactor, ...loaded, log, now });
  const startedAt = now();
  const machines = await adapter.checkWeightBaselines({ release, timeoutMs, signal, notBefore });
  const endedAt = now();
  const reasons = [...(release.sha ? [] : ['operator: release-sha-unknown']),
    ...Object.entries(machines).flatMap(([label, row]) => row.problems.map(problem => `${label}: ${problem}`))];
  const receipt = { schema: WEIGHT_CHECK_SCHEMA, ok: reasons.length === 0, reasons, startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(), ms: endedAt - startedAt, release, scanRelease: { ...WEIGHT_SCAN_RELEASE, notBefore }, machines };
  return JSON.parse(redactor.text(JSON.stringify(receipt)));
}

const progress = line => { process.stderr.write(line + '\n'); };

async function main() {
  const { values } = parseArgs({ options: { adapter: { type: 'string' }, work: { type: 'string' }, out: { type: 'string' },
    hosts: { type: 'string' }, fixture: { type: 'string' }, 'window-until': { type: 'string' },
    'verify-stage-directories': { type: 'boolean' }, 'prepare-stage-directories': { type: 'string' }, host: { type: 'string' },
    hash: { type: 'boolean' }, 'timeout-minutes': { type: 'string' } } });
  if (values['prepare-stage-directories'] !== undefined) {
    const minutes = Number(values['timeout-minutes'] ?? 240);
    if (values.adapter !== 'physical' || !values.hosts || values['window-until'] || !(minutes > 0)) {
      throw Error('Usage: run.js --adapter physical --hosts PRIVATE_FILE --prepare-stage-directories build|verify|check [--host LABEL] [--hash] [--out FILE] [--timeout-minutes N]');
    }
    const stop = new AbortController();
    for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => stop.abort(Error(`Received ${name}`)));
    if (values['prepare-stage-directories'] === 'check') {
      if (!values.out || !path.isAbsolute(values.out) || values.hash || values.host) {
        throw Error('Usage: run.js --adapter physical --hosts PRIVATE_FILE --prepare-stage-directories check --out ABSOLUTE_RECEIPT.json [--timeout-minutes N]');
      }
      const receipt = await checkStageDirectories({ config: await loadPhysicalConfig(values.hosts), transport: createSshTransport(),
        release: { sha: await readReleaseSha(), harnessDigest: await harnessDigest() }, timeoutMs: Math.round(minutes * 60000), signal: stop.signal, log: progress });
      await fs.writeFile(values.out, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      process.stdout.write(JSON.stringify({ ok: receipt.ok, reasons: receipt.reasons, scanMs: Object.fromEntries(Object.entries(receipt.machines)
        .map(([label, row]) => [label, row.scanMs])) }, null, 2) + '\n');
      process.exitCode = receipt.ok ? 0 : 1;
      return;
    }
    const results = await prepareStageDirectories({ config: await loadPhysicalConfig(values.hosts), transport: createSshTransport(),
      action: values['prepare-stage-directories'], labels: values.host ? [values.host] : null, hash: values.hash === true,
      timeoutMs: Math.round(minutes * 60000), signal: stop.signal, log: progress });
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
    const { weights = {}, ...stages } = results;
    process.exitCode = [...Object.values(stages), ...Object.values(weights)].every(row => row.ok) ? 0 : 1;
    return;
  }
  if (!['local', 'physical'].includes(values.adapter) || !values.work || !values.out || !path.isAbsolute(values.work) || !path.isAbsolute(values.out)
    || (values.fixture && !path.isAbsolute(values.fixture))) {
    throw Error('Usage: run.js --adapter local|physical --work ABSOLUTE_DIRECTORY --out ABSOLUTE_RECEIPT.json [--fixture ABSOLUTE_FILE]');
  }
  if (values.adapter === 'local' && (values.hosts || values['window-until'])) {
    throw Error('--hosts and --window-until apply only to the physical adapter');
  }
  const stop = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => stop.abort(Error(`Received ${name}`)));
  let result;
  if (values.adapter === 'local') result = await runLocalStage1({ directory: values.work, signal: stop.signal, fixtureFile: values.fixture ?? null });
  else {
    if (!values.hosts) throw Error('The physical adapter requires --hosts PRIVATE_FILE');
    // Refused here too, so a missing window never even reads the host file.
    resolveRunWindow(values['window-until'], { now: Date.now(), stopMarginMs: 0 });
    const config = await loadPhysicalConfig(values.hosts);
    result = await runPhysicalStage1({ config, transport: createSshTransport(), windowUntil: values['window-until'], directory: values.work,
      fixtureFile: values.fixture ?? null, signal: stop.signal, log: progress });
  }
  const { receipt, verdict } = result;
  await fs.writeFile(values.out, JSON.stringify({ receipt, verdict }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ ok: verdict.ok, label: verdict.label, reasons: verdict.reasons }, null, 2) + '\n');
  process.exitCode = verdict.ok ? 0 : 1;
  // An unconfirmed stop may have left a handle open; the started processes exit when this one does.
  if (receipt.hardStop && !receipt.hardStop.confirmed) process.exit(1);
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await main();
