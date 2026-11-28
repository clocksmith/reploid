// Independent heldout scorer. Run "freeze" before the case author releases a key.
// node tests/fixtures/community-lora-two-host-score.mjs probe --run-dir DIR   # first public training prompt only
// node tests/fixtures/community-lora-two-host-score.mjs freeze --run-dir DIR
// node tests/fixtures/community-lora-two-host-score.mjs score --run-dir DIR --freeze-sha256 HASH --key-file FILE
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadLoRAFromManifest } from 'dopplerx/training';

const study = new URL('../../examples/export-triage/', import.meta.url);
const labels = ['A', 'B'];
const arms = ['base', 'single', 'pooled'];
const adapterDirs = { single: 'task-reference', pooled: 'task' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';

async function fetchBytes(url) {
  const response = await fetch(url);
  assert(response.ok, `Fetching ${url} failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function captureInputs(runDir, modelUrl, policy) {
  const cases = {};
  const list = await readFile(new URL('frozen.sha256', study), 'utf8');
  for (const name of ['contract.json', 'holdout.sealed.json', 'train.jsonl', 'provenance.md']) {
    const bytes = await readFile(new URL(name, study));
    cases[name] = sha(bytes);
    assert(list.split('\n').includes(`${cases[name]}  ${name}`), `Study digest mismatch: ${name}`);
  }
  const contract = JSON.parse(await readFile(new URL('contract.json', study), 'utf8'));
  const modelBytes = await fetchBytes(new URL('manifest.json', modelUrl));
  const manifest = JSON.parse(modelBytes);
  assert.equal(manifest.modelId, policy.modelId, 'Wrong study base');
  assert.equal(manifest.tokenizer?.addBosToken, false, 'Raw scoring requires no added BOS');
  assert.equal(manifest.tokenizer.file, 'tokenizer.json');
  const tokenizer = await fetchBytes(new URL(manifest.tokenizer.file, modelUrl));
  const origin = new URL(modelUrl).origin;
  const runtime = JSON.parse(await fetchBytes(new URL('/config/doppler-package.json', origin)));
  const workoutBytes = await readFile(join(runDir, 'workout.json'));
  const workout = JSON.parse(workoutBytes);
  assert.equal(workout.status, 'passed');
  const candidates = {};
  const adapters = {};
  for (const [arm, dir] of Object.entries(adapterDirs)) {
    const metadata = await readFile(join(runDir, dir, 'adapter.json'));
    const adapter = JSON.parse(metadata);
    assert.equal(adapter.baseModel, manifest.modelId);
    assert.equal(adapter.metadata?.baseManifestHash, policy.baseManifestHash);
    assert.equal(adapter.metadata.checkpointStep, 16, 'Quality requires the complete training schedule');
    assert.equal(adapter.metadata.mode, arm === 'single' ? 'single-host-token-weighted-reference' : 'pooled');
    if (arm === 'pooled') assert.equal(new Set(adapter.metadata.participants).size, 2);
    const exported = arm === 'single' ? workout.taskReference : workout.task;
    assert.equal(exported.step, adapter.metadata.checkpointStep);
    assert.equal(exported.checkpointHash, adapter.metadata.checkpointHash);
    assert.equal(exported.manifestSha256, sha(metadata));
    assert.equal(adapter.weightsPath, 'adapter.safetensors');
    assert.equal(adapter.weightsFormat, 'safetensors');
    const bytes = await readFile(join(runDir, dir, adapter.weightsPath));
    const weightsSha256 = sha(bytes);
    assert.equal(exported.sha256, weightsSha256);
    assert.equal(adapter.weightsSize, bytes.byteLength);
    assert.equal(adapter.checksum?.replace(/^sha256:/, ''), weightsSha256);
    const decoded = await loadLoRAFromManifest(adapter, { readFile(path) {
      assert.equal(path, adapter.weightsPath);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } });
    const executionDigest = decoded.identity.digest;
    adapters[arm] = { manifest: adapter, weights: bytes.toString('base64'), executionDigest };
    candidates[arm] = { manifestSha256: sha(metadata), weightsSha256, weightsBytes: bytes.byteLength, executionDigest };
  }
  const pins = {
    schema: 'reploid.export-triage-score-freeze/v1',
    scorerSha256: sha(await readFile(new URL(import.meta.url))),
    study: cases, plaintextSha256: contract.cases.heldout.plaintextSha256,
    model: { modelId: manifest.modelId, manifestSha256: sha(modelBytes),
      numericManifestDigest: policy.baseManifestHash, tokenizerSha256: sha(tokenizer) },
    runtime, candidates, arms, primary: 'pooled', maxSeqLen: 512, readout: 'full-vocabulary-last-position',
    workoutSha256: sha(workoutBytes),
  };
  return { pins, contract, adapters };
}

function decryptCases(envelope, keyBytes, contract) {
  let key = keyBytes;
  if (key.length !== 32) {
    const encoded = keyBytes.toString('utf8').trim();
    key = Buffer.from(encoded, /^[0-9a-f]{64}$/i.test(encoded) ? 'hex' : 'base64');
  }
  assert.equal(key.length, 32, 'Expected a 256-bit case key');
  assert.equal(envelope.algorithm, 'aes-256-gcm');
  const cipher = createDecipheriv(envelope.algorithm, key, Buffer.from(envelope.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const bytes = Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext, 'base64')), cipher.final()]);
  assert.equal(sha(bytes), contract.cases.heldout.plaintextSha256, 'Wrong plaintext digest');
  const lines = bytes.toString('utf8').split('\n');
  assert.equal(lines.pop(), '', 'Missing final record terminator');
  const cases = lines.map(line => JSON.parse(line));
  const expectedIds = new Set();
  for (const [key, prefix] of [['task', 'test'], ['retention', 'control']]) {
    const counts = contract.cases.heldout[key];
    const subset = cases.filter(row => row.id.startsWith(prefix + '-'));
    for (const label of labels) assert.equal(subset.filter(row => row.label === label).length, counts[label]);
    for (let i = 1; i <= counts.A + counts.B; i++) expectedIds.add(prefix + '-' + String(i).padStart(2, '0'));
  }
  for (const row of cases) {
    assert(expectedIds.delete(row.id) && labels.includes(row.label), 'Unexpected or duplicate heldout record');
    assert(typeof row.prompt === 'string' && row.prompt.endsWith('\n') && !row.prompt.includes('\r'), 'Invalid raw prompt');
  }
  assert.equal(expectedIds.size, 0, 'Incomplete casebook');
  return cases;
}

// This normalization is conditional on choosing A or B. The gate uses only strict logit order.
export function choiceDecision(choices) {
  assert.deepEqual(choices.map(({ id }) => id), labels);
  const [a, b] = choices.map(choice => choice.logit);
  assert(Number.isFinite(a) && Number.isFinite(b), 'Nonfinite choice logit');
  const maximum = Math.max(a, b);
  const ea = Math.exp(a - maximum), eb = Math.exp(b - maximum);
  let prediction = null;
  if (a !== b) prediction = a > b ? 'A' : 'B';
  return { prediction,
    conditionalProbabilities: { A: ea / (ea + eb), B: eb / (ea + eb) } };
}

export function countScores(rows, gate) {
  const results = {};
  for (const arm of arms) {
    const task = rows.filter(row => row.id.startsWith('test-'));
    const controls = rows.filter(row => row.id.startsWith('control-'));
    const correct = row => row[arm].prediction === row.label;
    const taskCorrectByLabel = Object.fromEntries(labels.map(label =>
      [label, task.filter(row => row.label === label && correct(row)).length]));
    const taskCorrect = taskCorrectByLabel.A + taskCorrectByLabel.B;
    const controlLosses = controls.filter(row => row.base.prediction === row.label && !correct(row)).map(row => row.id);
    const summary = { taskCorrect, taskTotal: task.length, taskCorrectByLabel,
      retentionCorrect: controls.filter(correct).length, retentionTotal: controls.length, controlLosses };
    if (arm !== 'base') {
      summary.taskNetGain = taskCorrect - results.base.taskCorrect;
      summary.checks = {
        task: taskCorrect >= gate.minimumAdaptedTaskCorrect,
        perLabel: labels.every(label => taskCorrectByLabel[label] >= gate.minimumAdaptedTaskCorrectPerLabel),
        gain: summary.taskNetGain >= gate.minimumNetGainOverBaseInTaskCorrect,
        retention: controlLosses.length <= gate.maximumBaseCorrectRetentionItemsLost,
      };
      summary.passed = Object.values(summary.checks).every(Boolean);
    }
    results[arm] = summary;
  }
  return results;
}

async function openModel({ pins, modelUrl }) {
  const config = await import('/config/doppler-local-models.js');
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
  const runtime = await import(config.DOPPLER_MODULE_URL);
  if (runtime.DOPPLER_VERSION !== pins.runtime.version) throw new Error('Doppler version mismatch');
  const moduleUrl = new URL(config.DOPPLER_MODULE_URL, location.origin);
  const { computeCanonicalSha256 } = await import(new URL('./formats/canonical-hash.js', moduleUrl));
  // Doppler appends its own separator to the model base for bundled tokenizer assets.
  const model = await runtime.load({ url: modelUrl.replace(/\/+$/, '') }, { cache: false, isolatedLoader: true });
  globalThis.triageModel = model;
  if (model.manifest?.modelId !== pins.model.modelId || model.manifestHash?.replace(/^sha256:/, '') !== pins.model.manifestSha256
    || computeCanonicalSha256(model.manifest) !== pins.model.numericManifestDigest
    || model.activeLoRA || !model.deviceInfo?.vendor || model.deviceInfo.vendor === 'unknown'
    || /swiftshader|llvmpipe|software/i.test(JSON.stringify(model.deviceInfo))) throw new Error('Base identity or physical GPU mismatch');
  return model.deviceInfo;
}

async function setArm(adapter) {
  const model = globalThis.triageModel;
  if (model.activeLoRA) await model.unloadLoRA();
  if (model.activeLoRAIdentity) throw new Error('Active adapter persisted after unload');
  if (!adapter) return null;
  const bytes = Uint8Array.from(atob(adapter.weights), c => c.charCodeAt(0));
  await model.loadLoRA(adapter.manifest, { readFile(path) {
    if (path !== adapter.manifest.weightsPath) throw new Error('Unexpected adapter shard');
    return bytes.buffer;
  } });
  const identity = model.activeLoRAIdentity;
  if (identity?.id !== adapter.manifest.id || identity?.digest !== adapter.executionDigest) throw new Error('Adapter activation identity mismatch');
  return identity;
}

async function scorePrompt({ prompt, maxSeqLen }) {
  const model = globalThis.triageModel;
  const choices = ['A', 'B'].map(label => ({ id: label, label }));
  const tokenize = text => model.advanced.tokenizePrompt(text, { useChatTemplate: false });
  const promptTokens = tokenize(prompt);
  const tokenIds = choices.map(({ label }) => {
    const full = tokenize(prompt + label);
    if (full.length !== promptTokens.length + 1 || !promptTokens.every((id, i) => id === full[i])) throw new Error('Label changes prompt tokenization');
    return full.at(-1);
  });
  if (!promptTokens.length || promptTokens.length > maxSeqLen || tokenIds[0] === tokenIds[1]) throw new Error('Invalid input tokens');
  const adapter = model.activeLoRAIdentity?.digest;
  model.resetGenerationState();
  let result;
  try {
    // The q4k head supports full-vocabulary final-position logits; the selected-token kernel requires an f16 head.
    result = await model.advanced.prefillWithLogits(prompt, { inputIds: promptTokens, useChatTemplate: false, maxSeqLen });
    if (result.seqLen !== promptTokens.length || result.tokens.length !== promptTokens.length
      || !promptTokens.every((id, i) => id === result.tokens[i]) || !(result.logits instanceof Float32Array)
      || result.logits.length !== model.manifest.architecture.vocabSize || model.activeLoRAIdentity?.digest !== adapter) {
      throw new Error('Full-vocabulary readout did not match prompt length, token IDs, vocabulary or adapter');
    }
    return { promptTokens, choices: choices.map((choice, i) => {
      const tokenId = tokenIds[i], logit = result.logits[tokenId];
      if (!Number.isFinite(logit)) throw new Error('Nonfinite choice logit');
      return { ...choice, tokenId, logit };
    }) };
  } finally {
    result?.cache?.destroy();
    model.resetGenerationState();
  }
}

async function evaluate(options, pins, adapters, cases, contract, freezeSha256) {
  const { chromium } = await import('playwright');
  const browser = await chromium.connectOverCDP(options.cdp);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const rows = cases.map(({ id, label, prompt }) => ({ id, label, promptSha256: sha(prompt) }));
  try {
    const entry = new URL('/__export_triage_scorer__', options.origin).href;
    await page.route(entry, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Export triage scoring</title>' }));
    await page.goto(entry);
    const device = await page.evaluate(openModel, { pins, modelUrl: options.modelUrl });
    const activeAdapters = {};
    // Keep all observed outputs on a failed run. Exclusive creation prevents silently scoring the same holdout twice.
    const journalName = options.probe ? 'quality-public-probe-observations.jsonl' : 'quality-observations.jsonl';
    const journal = await open(join(options.runDir, journalName), 'wx');
    try {
      await journal.writeFile(JSON.stringify({ freezeSha256, device, browser: browser.version() }) + '\n');
      for (const arm of arms) {
        activeAdapters[arm] = await page.evaluate(setArm, adapters[arm] ?? null);
        for (const [i, { prompt }] of cases.entries()) {
          const { choices, promptTokens } = await page.evaluate(scorePrompt, { prompt, maxSeqLen: pins.maxSeqLen });
          const tokens = { promptTokensSha256: sha(JSON.stringify(promptTokens)), promptTokenCount: promptTokens.length,
            choiceTokenIds: choices.map(choice => choice.tokenId) };
          if (arm === 'base') rows[i].tokens = tokens;
          else assert.deepEqual(rows[i].tokens, tokens, 'Compared arms used different tokens');
          rows[i][arm] = { logits: Object.fromEntries(choices.map(c => [c.id, c.logit])), ...choiceDecision(choices) };
          await journal.writeFile(JSON.stringify({ arm, id: rows[i].id, tokens, result: rows[i][arm] }) + '\n');
        }
        console.log(`Scored ${rows.length} records for ${arm}`);
      }
    } finally { await journal.close(); }
    if (options.probe) {
      for (const arm of ['single', 'pooled']) {
        assert.notDeepEqual(rows[0][arm].logits, rows[0].base.logits, `Public probe: ${arm} adapter had no observable effect`);
      }
      return { schema: 'reploid.export-triage-public-probe/v1', pins, device, browser: browser.version(), activeAdapters, cases: rows };
    }
    const scores = countScores(rows, contract.gate);
    return { schema: 'reploid.export-triage-quality/v1', freezeSha256, pins, device, browser: browser.version(),
      activeAdapters, scores, primaryGatePassed: scores.pooled.passed, cases: rows };
  } finally {
    try { await page.evaluate(async () => { await globalThis.triageModel?.unload(); }); }
    finally { await context.close(); await browser.close(); }
  }
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(
    ['run-dir', 'origin', 'model-url', 'cdp', 'freeze-sha256', 'key-file'].map(name => [name, { type: 'string' }])) });
  assert(positionals.length === 1 && ['freeze', 'probe', 'score'].includes(positionals[0]) && values['run-dir'], 'Expected probe|freeze|score --run-dir DIR');
  const runDir = resolve(values['run-dir']);
  const origin = values.origin ?? 'http://127.0.0.1:18383';
  const policy = JSON.parse(await fetchBytes(new URL('/config/lora-training.json', origin)));
  const modelUrl = new URL((values['model-url'] ?? policy.modelPath).replace(/\/*$/, '/'), origin).href;
  assert.equal(new URL(modelUrl).origin, new URL(origin).origin, 'Model and scorer must share an origin');
  const options = { origin, modelUrl, runDir, cdp: values.cdp ?? 'http://127.0.0.1:18381' };
  const { pins, adapters, contract } = await captureInputs(runDir, modelUrl, policy);
  const freezeFile = join(runDir, 'score-freeze.json');
  const freezeSha256 = sha(json(pins));
  if (positionals[0] === 'probe') {
    const [first] = (await readFile(new URL('train.jsonl', study), 'utf8')).split('\n');
    const row = JSON.parse(first);
    assert.equal(row.id, 'train-01');
    const receipt = await evaluate({ ...options, probe: true }, pins, adapters, [row], contract, freezeSha256);
    await writeFile(join(runDir, 'quality-public-probe.json'), json(receipt), { flag: 'wx' });
    console.log(json(receipt.cases));
    return;
  }
  if (positionals[0] === 'freeze') {
    await writeFile(freezeFile, json(pins), { flag: 'wx' });
    console.log(json({ freezeFile, freezeSha256 }));
    return;
  }
  assert.equal(sha(await readFile(freezeFile)), values['freeze-sha256'], 'Incorrect freeze receipt hash');
  assert.equal(freezeSha256, values['freeze-sha256'], 'Scorer, data, or candidate changed since freeze');
  assert(values['key-file'], 'Scoring requires a key file from the case author');
  const envelope = JSON.parse(await readFile(new URL('holdout.sealed.json', study)));
  const cases = decryptCases(envelope, await readFile(values['key-file']), contract);
  const receipt = await evaluate(options, pins, adapters, cases, contract, freezeSha256);
  await writeFile(join(runDir, 'quality.json'), json(receipt), { flag: 'wx' });
  console.log(json({ primaryGatePassed: receipt.primaryGatePassed, scores: receipt.scores }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
