#!/usr/bin/env node
/** Prints capacity-weighted readiness utilization from exported records (reploid/measurement).
 *
 *   node scripts/capacity-utilization.js input.json|readiness.jsonl [more ...] [--from ms|ISO] [--to ms|ISO] [--observed-until ms|ISO] [--json]
 *
 * Each `.jsonl` input is a host readiness log (native --readiness-log): one recorded copy per line of a
 * reploid.readiness-span/v1 span or reploid.stage-admission/v1 admission. Every other input is a
 * `reploid.capacity-utilization-input/v1` document; arrays from several files are combined:
 *   interval { from, to }, observedUntil      epoch ms or ISO times (flags override)
 *   readiness[]      reploid.readiness-span/v1 spans per contributor stage
 *   readinessRecords[]  recorded span and admission copies (a browser's exportReadiness() or stored document);
 *                    readinessDropped counts copies a bounded store discarded
 *   admissions[]     resident reservation records; residentStates[] (resident getState() snapshots) also supply them
 *   attempts[]       { attemptId, status, satisfactory?, supply? }; workspaces[] (reploid.chat-workspace/v1 exports) also supply them
 *   quality[]        { attemptId, satisfactory } decisions merged into attempts
 *   contracts[]      readiness contracts; offers[] (reploid.contribution-offer/v1) also supply them
 * A recorded span still open counts only through its last observation; the rest stays unknown and is listed.
 * Unknown values print as unknown with their reasons; they are never zero. No prices are read or printed. */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { summarizeCapacityUtilization, attemptOutcomesFromWorkspace, readinessContractsFromOffers, readinessInputFromRecords }
  from '../packages/reploid/src/measurement/index.js';

const INPUT_SCHEMA = 'reploid.capacity-utilization-input/v1';
const epoch = value => value === undefined || value === null ? undefined
  : typeof value === 'number' ? value : /^\d+$/.test(value) ? Number(value) : Date.parse(value);

/** A readiness log's records. A line that is not JSON is a write a crash cut short; it is counted, not guessed. */
function readinessLog(text) {
  const records = [];
  let unreadable = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { unreadable++; }
  }
  return { records, unreadable };
}

export async function loadUtilizationInput(paths, overrides = {}) {
  const merged = { readiness: [], admissions: [], attempts: [], contracts: [], quality: [] };
  const recorded = { records: [], unreadableLines: 0, dropped: 0 };
  let interval = null, observedUntil;
  for (const path of paths) {
    if (path.endsWith('.jsonl')) {
      const log = readinessLog(await readFile(path, 'utf8'));
      recorded.records.push(...log.records); recorded.unreadableLines += log.unreadable;
      continue;
    }
    const doc = JSON.parse(await readFile(path, 'utf8'));
    if (doc?.schema !== INPUT_SCHEMA) throw new Error(`${path}: expected ${INPUT_SCHEMA}`);
    if (doc.interval) {
      const next = { from: epoch(doc.interval.from), to: epoch(doc.interval.to) };
      if (interval && (interval.from !== next.from || interval.to !== next.to)) throw new Error(`${path}: a different interval`);
      interval = next;
    }
    if (doc.observedUntil !== undefined) observedUntil = Math.min(observedUntil ?? Infinity, epoch(doc.observedUntil));
    merged.readiness.push(...(doc.readiness ?? []));
    merged.admissions.push(...(doc.admissions ?? []), ...(doc.residentStates ?? []).flatMap(state => state?.reservations?.records ?? []));
    merged.attempts.push(...(doc.attempts ?? []), ...(doc.workspaces ?? []).flatMap(attemptOutcomesFromWorkspace));
    merged.contracts.push(...(doc.contracts ?? []), ...readinessContractsFromOffers(doc.offers ?? []));
    merged.quality.push(...(doc.quality ?? []));
    recorded.records.push(...(doc.readinessRecords ?? []));
    recorded.dropped += Number.isSafeInteger(doc.readinessDropped) ? doc.readinessDropped : 0;
  }
  const folded = readinessInputFromRecords(recorded.records);
  merged.readiness.push(...folded.readiness); merged.admissions.push(...folded.admissions);
  const decisions = new Map(merged.quality.map(row => [row.attemptId, row.satisfactory]));
  return { interval: { from: epoch(overrides.from) ?? interval?.from, to: epoch(overrides.to) ?? interval?.to },
    observedUntil: epoch(overrides.observedUntil) ?? observedUntil, readiness: merged.readiness, admissions: merged.admissions,
    contracts: merged.contracts, attempts: merged.attempts.map(row => decisions.has(row.attemptId) ? { ...row, satisfactory: decisions.get(row.attemptId) } : row),
    recorded: { records: recorded.records.length, spans: folded.readiness.length, admissions: folded.admissions.length,
      unterminated: folded.unterminated, zeroLength: folded.zeroLength, unreadableLines: recorded.unreadableLines, dropped: recorded.dropped } };
}

const iso = ms => new Date(ms).toISOString();
/** What recorded readiness could not establish: open spans, cut-short lines and copies a bounded store dropped. */
export function formatRecordedReadiness(recorded) {
  if (!recorded?.records) return '';
  const lines = [`Recorded readiness: ${recorded.records} records, ${recorded.spans} spans, ${recorded.admissions} admissions; `
    + `${recorded.unterminated.length} spans unknown after their last observation, ${recorded.unreadableLines} unreadable lines, `
    + `${recorded.dropped} records dropped by a bounded store`];
  for (const row of recorded.unterminated.slice(0, 16)) {
    lines.push(`  ${row.participantId} stage ${row.stageIndex} of plan ${row.planId}: ${row.state} from ${iso(row.from)}, `
      + `unknown after ${iso(row.lastObservedAt)}`);
  }
  if (recorded.unterminated.length > 16) lines.push(`  ${recorded.unterminated.length - 16} more`);
  return lines.join('\n');
}

const value = (number, digits = 1) => number === null || number === undefined ? 'unknown' : number.toFixed(digits);
const ratio = (number, reasons) => number === null ? `unknown${reasons.length ? ` (${reasons.join(', ')})` : ''}` : number.toFixed(3);

export function formatUtilization(summary) {
  const lines = [`Interval ${new Date(summary.interval.from).toISOString()} to ${new Date(summary.interval.to).toISOString()}`
    + ` (records observed until ${new Date(summary.observedUntil).toISOString()})`];
  const block = (label, row) => {
    if (!row.maintained) { lines.push(`${label}: ${row.reason}`); return; }
    const { maintained: m, consumed: c, ratios: r, unit } = row;
    lines.push(`${label} [${unit}-seconds]`,
      `  maintained ready ${value(m.capacitySeconds)} (known ${value(m.knownCapacitySeconds)}; paid ${value(m.paidCapacitySeconds)}, unpaid ${value(m.unpaidCapacitySeconds)});`
        + ` unknown ${Math.round(m.unknownMs)} ms, undeclared capacity ${Math.round(m.undeclaredCapacityMs)} ms`,
      `  consumed ${value(c.capacitySeconds)} over ${c.admissions} admissions (${c.open} open, ${c.unknownAmount} unknown amount): `
        + Object.entries(c.byOutcome).filter(([, bucket]) => bucket.admissions).map(([name, bucket]) => `${name} ${value(bucket.capacitySeconds)}`).join(', '),
      `  useful/maintained ${ratio(r.usefulToMaintained, r.reasons)}; useful/paid ${ratio(r.usefulToPaid, r.reasons)}; occupied/maintained ${ratio(r.occupiedToMaintained, r.reasons)}`);
  };
  for (const contributor of summary.contributors) {
    block(`Contributor ${contributor.participantId}`, contributor.total);
    for (const stage of contributor.stages) block(`  stage ${stage.stageIndex} of plan ${stage.planId}`, stage);
  }
  for (const row of summary.routes) block(`Route ${row.route.participants.join(' > ')} (plan ${row.route.planId})`, row);
  const supply = Object.entries(summary.attempts.bySupply).filter(([, count]) => count).map(([name, count]) => `${name} ${count}`).join(', ');
  lines.push(`Attempts ${summary.attempts.total} by answer supply: ${supply || 'none'}`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' },
    'observed-until': { type: 'string' }, json: { type: 'boolean', default: false } } });
  if (!positionals.length) { console.error('Usage: node scripts/capacity-utilization.js input.json|readiness.jsonl [...] [--from] [--to] [--observed-until] [--json]'); process.exit(2); }
  const input = await loadUtilizationInput(positionals, { from: values.from, to: values.to, observedUntil: values['observed-until'] });
  const summary = summarizeCapacityUtilization(input);
  // With --json, stdout stays the reploid.capacity-utilization/v1 document and the record notes go to stderr.
  const notes = formatRecordedReadiness(input.recorded);
  if (notes) (values.json ? console.error : console.log)(notes);
  console.log(values.json ? JSON.stringify(summary, null, 2) : formatUtilization(summary));
}
