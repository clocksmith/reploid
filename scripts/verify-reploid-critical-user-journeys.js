import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './critical-user-journey-contract.js';

export const CATALOGUE_PATH = 'docs/critical-user-journeys.md';
// Compatibility inventory, not a limit on new families or journeys.
const STABLE_IDS = `CHAT-01 CHAT-02 CHAT-03 CHAT-04 CHAT-05
KEEP-01 KEEP-02 KEEP-03 KEEP-04 KEEP-05
CONTRIB-01 CONTRIB-02 CONTRIB-03 CONTRIB-04 CONTRIB-05
MESH-01 MESH-02 MESH-03 MESH-04 MESH-05
JOB-01 JOB-02 JOB-03 JOB-04 JOB-05 JOB-06
TRUST-01 TRUST-02 TRUST-03 TRUST-04 TRUST-05 DEV-01 DEV-02`.split(/\s+/);
const FIELDS = ['Actor and trigger', 'Starting conditions', 'Main flow',
  'Successful outcome', 'Interruption and recovery', 'Variants', 'Acceptance evidence'];
const links = (text) => [...text.matchAll(/\[[^\]\n]+\]\(([^)\n]+)\)/g)].map(match => match[1]);

function anchors(text) {
  const result = new Set();
  const counts = new Map();
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = match[1].trim().toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    result.add(count ? `${base}-${count}` : base);
  }
  for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
}

export async function validateReploidCriticalUserJourneys(text, { root = PROJECT_ROOT } = {}) {
  const errors = [];
  const ids = new Set();
  const headings = [...text.matchAll(/^###\s+(.+)$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const parsed = heading[1].match(/^([A-Z]+-\d{2}) — (\S.*)$/);
    if (!parsed) {
      errors.push(`Malformed journey heading: ${heading[1]}`);
      continue;
    }
    const id = parsed[1];
    if (ids.has(id)) errors.push(`Duplicate journey ID: ${id}`);
    ids.add(id);
    const body = text.slice(heading.index + heading[0].length, headings[index + 1]?.index).split(/^## /m)[0];
    const labels = [...body.matchAll(/^- \*\*([^*]+):\*\*/gm)];
    const fields = labels.map((label, position) => [label[0], label[1],
      body.slice(label.index + label[0].length, labels[position + 1]?.index).trim()]);
    for (const name of FIELDS) {
      const values = fields.filter(field => field[1] === name);
      if (values.length !== 1 || !values[0][2].trim()) errors.push(`${id}: require one nonempty ${name} field`);
    }
    for (const field of fields) {
      if (!FIELDS.includes(field[1])) errors.push(`${id}: unknown field ${field[1]}`);
      if (field[1] === 'Acceptance evidence' && links(field[2]).length === 0) errors.push(`${id}: acceptance evidence requires a link`);
    }
  }
  for (const id of STABLE_IDS) if (!ids.has(id)) errors.push(`Missing stable journey ID: ${id}`);
  for (const match of text.matchAll(/\b[A-Z]+-\d{2}\b/g)) {
    if (!ids.has(match[0])) errors.push(`Unknown journey reference: ${match[0]}`);
  }

  const scenarioHeader = '| Scenario | Journeys exercised | Deployment variant | Acceptance boundary |';
  const lines = text.split('\n');
  const tableStart = lines.indexOf(scenarioHeader);
  if (tableStart < 0) errors.push('Missing scenario coverage table');
  else {
    const rows = [];
    for (let index = tableStart + 1; index < lines.length && lines[index].trim(); index += 1) rows.push(lines[index]);
    if (!/^\|(?:\s*:?-+:?\s*\|){4}$/.test(rows.shift() || '')) errors.push('Invalid scenario table separator');
    if (!rows.length) errors.push('Scenario coverage table requires a scenario');
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
      if (!row.startsWith('|') || !row.endsWith('|') || cells.length !== 4 || cells.some(cell => !cell)) errors.push(`Incomplete scenario: ${row}`);
      if (!/^[A-Z]+-\d{2}(?:, [A-Z]+-\d{2})*$/.test(cells[1] || '')) errors.push(`Scenario must list explicit journey IDs: ${cells[0]}`);
    }
  }

  const documents = new Map([[path.resolve(root, CATALOGUE_PATH), text]]);
  for (const target of new Set(links(text))) {
    if (/^https?:\/\//.test(target)) {
      try { new URL(target); } catch { errors.push(`Invalid external link: ${target}`); }
      continue; // Link integrity only; no remote availability or acceptance claim.
    }
    try {
      const [file, fragment] = target.split('#');
      const resolved = path.resolve(root, 'docs', decodeURIComponent(file || 'critical-user-journeys.md'));
      if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('outside repository');
      if (!documents.has(resolved)) documents.set(resolved, await readFile(resolved, 'utf8'));
      if (fragment && !anchors(documents.get(resolved)).has(decodeURIComponent(fragment))) throw new Error('missing anchor');
    } catch (error) {
      errors.push(`Broken catalogue link: ${target} (${error.code || error.message})`);
    }
  }
  return [...new Set(errors)];
}

export async function verifyReploidCriticalUserJourneys() {
  return validateReploidCriticalUserJourneys(await readFile(path.join(PROJECT_ROOT, CATALOGUE_PATH), 'utf8'));
}
