import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './critical-user-journey-contract.js';

export const CATALOGUE_PATH = 'docs/critical-user-journeys.md';
// Compatibility inventory, not a limit on new families or journeys.
const STABLE_IDS = `CHAT-01 CHAT-02 CHAT-03 CHAT-04 CHAT-05
KEEP-01 KEEP-02 KEEP-03 KEEP-04 KEEP-05
CONTRIB-01 CONTRIB-02 CONTRIB-03 CONTRIB-04 CONTRIB-05
MESH-01 MESH-02 MESH-03 MESH-04 MESH-05 MESH-06
JOB-01 JOB-02 JOB-03 JOB-04 JOB-05 JOB-06
TRUST-01 TRUST-02 TRUST-03 TRUST-04 TRUST-05 TRUST-06 DEV-01 DEV-02
FIRST-01 FIRST-02 FIRST-03 FIRST-04`.split(/\s+/);
const FIELDS = ['Actor and trigger', 'Starting conditions', 'Main flow',
  'Successful outcome', 'Interruption and recovery', 'Variants', 'Acceptance evidence',
  'Acceptance criteria', 'Evidence status'];
// The owner's four public-page journeys (FIRST-01 to FIRST-04) map onto catalogue journeys.
const FIRST_FIELDS = ["Owner's journey", 'Covers', 'Acceptance criteria', 'Evidence status'];
export const EVIDENCE_STATUSES = ['not shown', 'source integration', 'physical acceptance', 'release qualified'];
const OWNER_TEXT_START = '<!-- owner-text:start -->\n';
const OWNER_TEXT_END = '<!-- owner-text:end -->';
// The owner's words, byte for byte. Change this copy, and the catalogue, only on the owner's word.
export const OWNER_FIRST_VISIT_TEXT = `1. **First visit → join the mesh.** When replo.id opens, the browser automatically joins the
   peer network and discovers available model storage and compute. No Join button or network
   setup. Joining lets the visitor use the mesh. It does not make their device a contributor.
2. **Join → ask → get an answer.** The visitor types and sends. Reploid picks defaults
   automatically using what the browser can detect or infer about the device and what's
   available on the mesh. The visitor can change the model or request settings, but neither is
   a prerequisite for sending. Do not infer a privacy preference or budget. The answer appears
   in the conversation, where the visitor can continue chatting.
3. **Use the mesh → contribute.** A visitor can find and start contribution from the same
   experience. They explicitly choose to offer model storage, compute, or both. The journey is
   complete when they can tell what their device is offering and whether it's available to the
   mesh.
4. **Inspect the mesh.** When curious or troubleshooting, a visitor can see which devices are
   ready and what each offers. This is optional; it never gates Ask.

**Acceptance:** A first-time visitor can open replo.id and get an answer without configuring
anything. If they want to contribute, they can find that path without leaving the experience
to figure out how the network works.
`;
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
  const covers = new Map();
  // Journey headings start with an ID-like prefix; other third-level headings (the rules and checks under
  // the public-page bar) are prose.
  const headings = [...text.matchAll(/^###\s+(.+)$/gm)].filter(heading => /^[A-Z]{2,}-/.test(heading[1]));
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
    const required = id.startsWith('FIRST-') ? FIRST_FIELDS : FIELDS;
    for (const name of required) {
      const values = fields.filter(field => field[1] === name);
      if (values.length !== 1 || !values[0][2].trim()) errors.push(`${id}: require one nonempty ${name} field`);
    }
    for (const field of fields) {
      if (!required.includes(field[1])) errors.push(`${id}: unknown field ${field[1]}`);
      if (field[1] === 'Acceptance evidence' && links(field[2]).length === 0) errors.push(`${id}: acceptance evidence requires a link`);
      if (field[1] === 'Acceptance criteria' && !/(?:^|\n)\s*1\. \S/.test(field[2])) errors.push(`${id}: acceptance criteria require a numbered list`);
      if (field[1] === 'Evidence status') {
        const status = EVIDENCE_STATUSES.find(value => field[2].startsWith(value)
          && /^(?:[.;:,(]|\s|$)/.test(field[2].slice(value.length)));
        if (!status) errors.push(`${id}: evidence status must start with one of: ${EVIDENCE_STATUSES.join(', ')}`);
        else if (status !== 'not shown' && status !== 'source integration'
          && !/\b[0-9a-f]{9,40}\b/.test(field[2]) && links(field[2]).length === 0) {
          errors.push(`${id}: ${status} must name its retained receipt or commit`);
        }
      }
      if (field[1] === 'Covers') covers.set(id, field[2]);
    }
  }
  for (const [id, value] of covers) {
    const targets = value.split(/,\s*/).map(entry => entry.trim()).filter(Boolean);
    if (!targets.length) errors.push(`${id}: Covers must list catalogue journey IDs`);
    for (const target of targets) {
      if (!/^[A-Z]+-\d{2}$/.test(target) || target.startsWith('FIRST-')) errors.push(`${id}: Covers entry is not a catalogue journey ID: ${target}`);
      else if (!ids.has(target)) errors.push(`${id}: covers unknown catalogue journey ${target}`);
    }
  }
  for (const id of ids) {
    if (id.startsWith('FIRST-') && !covers.has(id)) errors.push(`${id}: requires a Covers field`);
  }
  const ownerStart = text.indexOf(OWNER_TEXT_START);
  const ownerEnd = text.indexOf(OWNER_TEXT_END, ownerStart + 1);
  if (ownerStart < 0 || ownerEnd < 0) errors.push("Missing the owner's first-visit journeys between owner-text markers");
  else if (text.slice(ownerStart + OWNER_TEXT_START.length, ownerEnd) !== OWNER_FIRST_VISIT_TEXT) {
    errors.push("The owner's first-visit journeys differ from the pinned copy; change them only on the owner's word");
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
