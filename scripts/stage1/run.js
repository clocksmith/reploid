#!/usr/bin/env node
/**
 * Runs and judges one Stage 1 split receipt.
 *
 *   node scripts/stage1/run.js --adapter local --work DIRECTORY --out RECEIPT.json
 *
 * Only the local adapter exists: three processes on this machine with a fake model runtime. The written file holds
 * the receipt and the checker's verdict; exit status 0 means the checker passed.
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

/** Runs the phases on the local adapter and returns `{ receipt, verdict }`. */
export async function runLocalStage1({ directory, limits, signal }) {
  const loaded = await loadStage1Expectations({ runtimeClass: 'fake-runtime' });
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const adapter = createLocalStage1Adapter({ directory, ...loaded });
  const receipt = await runStage1Phases({ adapter, expectations: loaded.expectations, limits, signal });
  return { receipt, verdict: checkStage1Receipt(receipt, loaded.expectations), expectations: loaded.expectations };
}

async function main() {
  const { values } = parseArgs({ options: { adapter: { type: 'string' }, work: { type: 'string' }, out: { type: 'string' } } });
  if (values.adapter !== 'local' || !values.work || !values.out || !path.isAbsolute(values.work) || !path.isAbsolute(values.out)) {
    throw Error('Usage: run.js --adapter local --work ABSOLUTE_DIRECTORY --out ABSOLUTE_RECEIPT.json');
  }
  const stop = new AbortController();
  for (const name of ['SIGINT', 'SIGTERM']) process.once(name, () => stop.abort(Error(`Received ${name}`)));
  const { receipt, verdict } = await runLocalStage1({ directory: values.work, signal: stop.signal });
  await fs.writeFile(values.out, JSON.stringify({ receipt, verdict }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify({ ok: verdict.ok, label: verdict.label, reasons: verdict.reasons }, null, 2) + '\n');
  process.exitCode = verdict.ok ? 0 : 1;
  // An unconfirmed stop may have left a handle open; the started processes exit when this one does.
  if (receipt.hardStop && !receipt.hardStop.confirmed) process.exit(1);
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) await main();
