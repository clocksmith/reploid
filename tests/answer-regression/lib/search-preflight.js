// Preflight for the frozen search set, run before any model: deterministic retrieval records, the sources each item
// expects to be cited, context sizes and, when a Doppler archive and Capsule are given, the dispatched prompt's token
// count through the application text path (no GPU). No answer is generated.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { SEARCH_SET, SEARCH_SET_SHA256, USEFUL_ANSWER_DIR, fail, frozenFile, labelBlock, nowIso, repoRelative, resolvePath,
  retrievalComponentIdentity, sha256File } from './common.js';
import { nodeHelper } from './checks.js';
import { cpLength } from './python-compat.js';
import { extractArchive } from './targets.js';

// The useful-answer set's frozen text path (JavaScript), pinned by sha256.
export const DOPPLER_TEXT = path.join(USEFUL_ANSWER_DIR, 'scripts', 'doppler-text.mjs');
export const DOPPLER_TEXT_SHA256 = 'f369092f750b757513a35eea3e8be1a821c7a71af68af176311dcb0768573dc7';

const numbers = text => new Set([...text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)].map(match => Number(match[0].replaceAll(',', ''))));

async function tokenCounts(archive, capsule, contents) {
  if (!fs.existsSync(DOPPLER_TEXT) || sha256File(DOPPLER_TEXT) !== DOPPLER_TEXT_SHA256) fail('doppler-text.mjs is missing or changed');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'reploid-search-preflight-'));
  try {
    const packageRoot = extractArchive(archive, path.join(work, 'package-archive'));
    const child = spawn(process.execPath, [DOPPLER_TEXT, packageRoot, capsule], { stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const next = async () => JSON.parse((await lines.next()).value);
    const ready = await next();
    const counts = [];
    for (const content of contents) {
      child.stdin.write(`${JSON.stringify({ op: 'render', messages: [{ role: 'user', content }] })}\n`);
      const reply = await next();
      counts.push(reply.ok ? reply.ids.length : null);
    }
    child.stdin.end();
    await new Promise(resolve => child.on('close', resolve));
    return [counts, { dopplerVersion: ready.dopplerVersion ?? null, chatTemplate: ready.chatTemplate ?? null,
      archiveSha256: sha256File(archive) }];
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

export async function preflight(archiveValue, capsuleValue, log) {
  const data = frozenFile(SEARCH_SET, SEARCH_SET_SHA256, 'search-task set');
  const requests = data.items.map(item => ({ op: 'prepare', documents: item.documents, query: item.prompt,
    limits: data.retrieval.limits, now: data.retrieval.fixedNow, messages: [{ role: 'user', content: item.prompt }] }));
  const replies = nodeHelper(requests);
  const rows = [];
  const rowReplies = [];
  const problems = [];
  data.items.forEach((item, index) => {
    const reply = replies[index];
    if (!reply.ok) {
      problems.push(`${item.id}: ${reply.error}`);
      return;
    }
    const record = reply.record;
    const numbered = Object.fromEntries(record.sources.map(source => [source.sourceId, source.number]));
    const missing = item.citedSources.filter(doc => !(doc in numbered));
    if (record.outcome !== item.expectedOutcome) problems.push(`${item.id}: outcome ${record.outcome} != expected ${item.expectedOutcome}`);
    if (missing.length) problems.push(`${item.id}: expected cited sources not retrieved: ${JSON.stringify(missing)}`);
    for (const check of item.answerChecks) {
      if (check.type === 'number' && numbers(item.prompt).has(Number(check.value))) {
        problems.push(`${item.id}: expected ${check.value} appears in the question`);
      }
    }
    const dispatched = reply.dispatchedMessages;
    rows.push({ id: item.id, kind: item.kind, outcome: record.outcome, error: record.error ?? null,
      sources: record.sources.map(source => [source.number, source.sourceId]),
      citedSourceMarkers: Object.fromEntries(item.citedSources.map(doc => [doc, numbered[doc] ?? null])),
      contextCharacters: (record.context || {}).characters ?? null, contextDigest: (record.context || {}).digest ?? null,
      dispatchedCharacters: dispatched ? cpLength(dispatched.at(-1).content) : null, failureMessage: reply.failureMessage ?? null });
    rowReplies.push(reply);
    log(`${item.id}: ${record.outcome} ${JSON.stringify(rows.at(-1).sources)}`);
  });
  let textPath = null;
  if (archiveValue && capsuleValue) {
    const dispatchedRows = rows.map((row, index) => [row, rowReplies[index]]).filter(([, reply]) => reply.dispatchedMessages);
    const [counts, identity] = await tokenCounts(resolvePath(archiveValue), resolvePath(capsuleValue),
      dispatchedRows.map(([, reply]) => reply.dispatchedMessages.at(-1).content));
    textPath = identity;
    dispatchedRows.forEach(([row], index) => {
      row.dispatchedPromptTokens = counts[index];
    });
  }
  return { schema: 'reploid.answer-regression.search-preflight/v1', ...labelBlock(), checkedAt: nowIso(),
    searchSet: { file: repoRelative(SEARCH_SET), sha256: sha256File(SEARCH_SET) },
    retrievalComponent: retrievalComponentIdentity(), textPath, modelRun: false, items: rows, problems,
    note: 'No answer was generated. Prompt token counts use the qwen template and tokenizer of the Launch 1 model.' };
}
