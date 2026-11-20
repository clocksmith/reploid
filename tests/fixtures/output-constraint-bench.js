// Manual benchmark for shared/infrastructure/output-constraint.js; no GPU and no model.
//
//   node tests/fixtures/output-constraint-bench.js <tokenizer.json> [--doppler <doppler-gpu directory>]
//
// Loads the tokenizer through Doppler's tokenizer loader, builds the token table and
// times the logit mask over simulated calls for a two-tool schema. Without a tokenizer
// path it uses a synthetic 150,000-token vocabulary and says so in the report.
// Each step is timed twice: elapsed time, and the process CPU time, which is the one to
// read when other work shares the machine (the report carries the load average).
import { readFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileConstraint, createLogitMask, prepareTokenTable } from '../../shared/infrastructure/output-constraint.js';
import { parseToolCallOutput } from '../../shared/infrastructure/tool-call-format.js';

const TOOLS = [
  { name: 'get_weather', description: 'Current weather for a city.', parameters: { type: 'object',
    properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'] }, days: { type: 'integer' } },
    required: ['city'], additionalProperties: false } },
  { name: 'search_documents', description: 'Search the document store.', parameters: { type: 'object',
    properties: { query: { type: 'string', maxLength: 200 }, tags: { type: 'array', items: { type: 'string' }, maxItems: 4 },
      exact: { type: 'boolean' } },
    required: ['query'], additionalProperties: false } }
];
const SAMPLE = '<tool_call>\n{"name": "search_documents", "arguments": {"query": "quarterly \\"revenue\\" by region", '
  + '"tags": ["finance", "2026"], "exact": true}}\n</tool_call>';
const END_TEXTS = ['<|im_end|>', '<|endoftext|>', '</s>', '<eos>', '<end_of_turn>'];

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A deterministic stand-in vocabulary: single characters, then random ASCII pieces.
function syntheticTokenizer(size) {
  const next = random(7), pieces = [], seen = new Set();
  const alphabet = ' \n\t"\\{}[]:,.<>/_-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const add = text => {
    if (!seen.has(text)) {
      seen.add(text);
      pieces.push(text);
    }
  };
  for (const char of alphabet) add(char);
  for (const text of ['<tool_call>', '</tool_call>', '{"', '":', '",', '"}', '}}', ' "', '": "', '", "']) add(text);
  while (pieces.length < size - 1) {
    let text = '';
    for (let length = 2 + Math.floor(next() * 7); length > 0; length -= 1) text += alphabet[Math.floor(next() * alphabet.length)];
    add(text);
  }
  const index = new Map(pieces.map((text, id) => [text, id]));
  return { endIds: [size - 1], vocabSize: size,
    decode: ids => ids.map(id => pieces[id] ?? '').join(''),
    encode(text) {
      const ids = [];
      for (let at = 0; at < text.length;) {
        let length = Math.min(12, text.length - at);
        while (length > 1 && !index.has(text.slice(at, at + length))) length -= 1;
        ids.push(index.get(text.slice(at, at + length)));
        at += length;
      }
      return ids;
    } };
}

async function dopplerTokenizer(file, packageRoot) {
  const { Tokenizer } = await import(pathToFileURL(resolve(packageRoot, 'src/inference/tokenizer.js')).href);
  const json = JSON.parse(await readFile(file, 'utf8'));
  const added = Array.isArray(json.added_tokens) ? json.added_tokens : [];
  const endIds = added.filter(token => END_TEXTS.includes(token.content)).map(token => Number(token.id));
  const tokenizer = new Tokenizer();
  await tokenizer.initialize({ modelId: 'output-constraint-bench', eos_token_id: endIds[0],
    tokenizer: { type: 'bundled', file: 'tokenizer.json', addBosToken: false } }, { loadTokenizerJson: async () => json });
  const eos = tokenizer.getSpecialTokens().eos;
  if (Number.isInteger(eos) && !endIds.includes(eos)) endIds.push(eos);
  tokenizer.endIds = endIds;
  tokenizer.vocabSize = tokenizer.getVocabSize();
  return tokenizer;
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = value => Math.round(value * 1000) / 1000;
  return { steps: sorted.length, median: round(quantile(sorted, 0.5)), p95: round(quantile(sorted, 0.95)), max: round(sorted[sorted.length - 1]) };
}

// One simulated call: mask random logits, then take the scripted token or the best allowed one.
function simulate({ tokenizer, constraint, seed, scripted }) {
  const next = random(seed), size = tokenizer.vocabSize, ends = new Set(tokenizer.endIds);
  const mask = createLogitMask({ constraint, endTokenIds: tokenizer.endIds });
  const logits = new Float32Array(size), ids = [], times = [], cpu = [], allowed = [];
  let scriptedAllowed = true;
  for (let step = 0; step < 400; step += 1) {
    for (let id = 0; id < size; id += 1) logits[id] = next();
    const started = performance.now(), usage = process.cpuUsage();
    mask(logits, { generatedIds: ids, tokenizer, vocabSize: size });
    times.push(performance.now() - started);
    const spent = process.cpuUsage(usage);
    cpu.push((spent.user + spent.system) / 1000);
    let best = -1, count = 0;
    for (let id = 0; id < size; id += 1) {
      if (logits[id] === -Infinity) continue;
      count += 1;
      if (best < 0 || logits[id] > logits[best]) best = id;
    }
    allowed.push(count);
    if (scripted) {
      if (step === scripted.length) {
        scriptedAllowed &&= tokenizer.endIds.every(id => logits[id] !== -Infinity);
        break;
      }
      scriptedAllowed &&= logits[scripted[step]] !== -Infinity;
      best = scripted[step];
    }
    if (ends.has(best)) break;
    ids.push(best);
  }
  return { ids, times, cpu, allowed, scriptedAllowed };
}

function measure(tokenizer, label) {
  const report = { tokenizer: label, vocabSize: tokenizer.vocabSize, endTokenIds: tokenizer.endIds,
    loadAverage: loadavg().map(value => Math.round(value * 10) / 10) };
  let started = performance.now();
  const table = prepareTokenTable(tokenizer, tokenizer.vocabSize);
  report.tableBuildMs = Math.round(performance.now() - started);
  report.table = { tokensWithText: table.known, trieNodes: table.trie.code.length,
    tokensWithoutText: table.blocked.length - table.partialIds.length, partialCharacterTokens: table.partialIds.length };
  started = performance.now();
  const settings = { tools: TOOLS, toolChoice: 'required' };
  const constraint = compileConstraint({ kind: 'tool-call', ...settings });
  report.compileMs = Math.round((performance.now() - started) * 1000) / 1000;

  const scripted = tokenizer.encode(SAMPLE);
  const cold = simulate({ tokenizer, constraint, seed: 1, scripted });
  const warm = simulate({ tokenizer, constraint, seed: 2, scripted });
  const sortedAllowed = [...cold.allowed].sort((a, b) => a - b);
  report.naturalCall = { tokens: scripted.length, everyTokenAllowed: cold.scriptedAllowed && warm.scriptedAllowed,
    firstUseMs: summary(cold.times), firstUseCpuMs: summary(cold.cpu),
    repeatedMs: summary(warm.times), repeatedCpuMs: summary(warm.cpu),
    allowedTokens: { min: sortedAllowed[0], median: quantile(sortedAllowed, 0.5), max: sortedAllowed[sortedAllowed.length - 1] },
    allowedPerStep: cold.allowed };

  const times = [], cpu = [], allowed = [];
  let parsed = 0, runs = 0;
  for (let seed = 10; seed < 40; seed += 1) {
    const fresh = compileConstraint({ kind: 'tool-call', ...settings });
    const run = simulate({ tokenizer, constraint: fresh, seed });
    const result = parseToolCallOutput(tokenizer.decode(run.ids, true, false), settings);
    runs += 1;
    if (result.complete && !result.error && result.toolCalls.length === 1) parsed += 1;
    times.push(...run.times);
    cpu.push(...run.cpu);
    allowed.push(...run.allowed);
  }
  allowed.sort((a, b) => a - b);
  report.randomCalls = { runs, completedAndValid: parsed, perStepMs: summary(times), perStepCpuMs: summary(cpu),
    allowedTokens: { min: allowed[0], median: quantile(allowed, 0.5), max: allowed[allowed.length - 1] },
    note: 'Random logits, a freshly compiled constraint per run (nothing cached between runs); runs that reach 400 steps are cut off.' };
  return report;
}

const args = process.argv.slice(2);
const flag = args.indexOf('--doppler');
const packageRoot = flag >= 0 ? args.splice(flag, 2)[1] : resolve(import.meta.dirname, '../../node_modules/dopplerx');
const file = args[0];
const tokenizer = file ? await dopplerTokenizer(resolve(file), packageRoot) : syntheticTokenizer(150000);
console.log(JSON.stringify(measure(tokenizer, file ? 'doppler tokenizer.json' : 'synthetic 150000-token vocabulary'), null, 2));
