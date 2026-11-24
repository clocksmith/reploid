#!/usr/bin/env node
/**
 * Runs and judges one Stage 1 split receipt.
 *
 *   node scripts/stage1/run.js --adapter local --work DIRECTORY --out RECEIPT.json [--fixture FILE]
 *   node scripts/stage1/run.js --adapter physical --hosts PRIVATE_FILE --window-until ISO_TIME --work DIRECTORY
 *     --out RECEIPT.json [--fixture FILE]
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
import { createPhysicalStage1Adapter } from './physical-adapter.js';
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
  signal = null, now = Date.now, startCoordinator }) {
  validatePhysicalConfig(config);
  const { maxRunMs } = resolveRunWindow(windowUntil, { now: now(), stopMarginMs: config.limits.stopMarginMs });
  const loaded = await loadWorkload('physical', fixtureFile, config.credit.weights);
  const redactor = createRedactor(config);
  const adapter = createPhysicalStage1Adapter({ config, directory, transport, redactor, ...loaded,
    ...(startCoordinator ? { startCoordinator } : {}) });
  const { phaseMs, abortGraceMs, hardStopMs } = config.limits;
  const raw = await runStage1Phases({ adapter, expectations: loaded.expectations, signal, now,
    limits: { maxRunMs, phaseMs, abortGraceMs, hardStopMs } });
  const receipt = redactor.receipt(raw);
  return { receipt, verdict: checkStage1Receipt(receipt, loaded.expectations), expectations: loaded.expectations };
}

async function main() {
  const { values } = parseArgs({ options: { adapter: { type: 'string' }, work: { type: 'string' }, out: { type: 'string' },
    hosts: { type: 'string' }, fixture: { type: 'string' }, 'window-until': { type: 'string' } } });
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
      fixtureFile: values.fixture ?? null, signal: stop.signal });
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
