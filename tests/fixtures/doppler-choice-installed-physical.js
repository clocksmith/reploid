// Real installed Doppler Capsule -> installed Reploid provider -> typed decision.
// Isolated Node/Vulkan process; this does not claim WebRTC or physical-device pooling.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { create, globals } from 'webgpu';

const [dopplerRoot, reploidRoot, capsulePath, signerPath, qualificationPath, archivePath, outputPath] = process.argv.slice(2);
assert(outputPath, 'Expected installed Doppler/Reploid roots, Capsule, public signer, qualification, archive, report');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const dopplerInfo = await read(resolve(dopplerRoot, 'package.json'));
const reploidInfo = await read(resolve(reploidRoot, 'package.json'));
assert.equal(dopplerInfo.name, 'doppler-gpu'); assert.equal(reploidInfo.name, 'reploid');
const api = await import(pathToFileURL(resolve(dopplerRoot, dopplerInfo.exports['.'].import)));
const host = await import(pathToFileURL(resolve(dopplerRoot, dopplerInfo.exports['./host'].import)));
const library = await import(pathToFileURL(resolve(reploidRoot, reploidInfo.exports['./doppler'].import)));
const { resolveConfig } = await import(pathToFileURL(resolve(reploidRoot, reploidInfo.exports['./config'].import)));
const qualification = await read(qualificationPath);
assert.equal(qualification.passed, true);
const report = { schema: 'reploid.installed-choice-physical/v1', passed: false,
  archiveSha256: await hash(archivePath), dopplerVersion: dopplerInfo.version, reploidVersion: reploidInfo.version,
  capsuleSha256: await hash(capsulePath), qualificationSha256: await hash(qualificationPath),
  releaseScope: 'Local integration Capsule with test release metadata; no public release qualification.',
  executionClass: 'installed-public-capsule-and-reploid-real-node-vulkan', cases: [], checks: [] };
const devices = [], destroyed = new WeakSet();
let controllerAfterSubmit, provider, session;
Object.assign(globalThis, globals);
const gpu = create(['backend=vulkan']);
Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });
const requestAdapter = gpu.requestAdapter.bind(gpu);
gpu.requestAdapter = async options => {
  const adapter = await requestAdapter(options), requestDevice = adapter.requestDevice.bind(adapter);
  adapter.requestDevice = async descriptor => {
    const device = await requestDevice(descriptor), destroy = device.destroy.bind(device), submit = device.queue.submit.bind(device.queue);
    device.destroy = () => { destroyed.add(device); return destroy(); };
    device.queue.submit = commands => {
      const result = submit(commands), controller = controllerAfterSubmit;
      controllerAfterSubmit = null;
      controller?.abort(new Error('Caller cancelled after GPU submission'));
      return result;
    };
    devices.push(device); return device;
  };
  return adapter;
};
try {
  const capsule = await read(capsulePath), publicKey = await read(signerPath);
  session = await host.openCapsule(resolve(capsulePath), { trustedSigners: { [capsule.signature.authority]: publicKey },
    requiredOperations: ['scoreChoices'] });
  report.deviceProfile = session.deviceProfile;
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(session.deviceProfile)), 'Physical GPU required');
  report.verification = session.verification;
  const contract = Object.fromEntries(['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest'].map(key => [key, session[key]]));
  contract.runtimeVersion = api.DOPPLER_VERSION;
  const config = resolveConfig({ overrides: { models: { providerId: 'doppler', contract } } });
  provider = library.createDopplerOperationProvider({ config, session, ownership: 'borrowed', runtime: api });
  const request = (row, schema = 'doppler.capsule-operation-request/v2') => ({ schema,
    operation: { name: 'scoreChoices', version: 1 }, input: { prompt: row.input.prompt, choices: row.input.choices },
    options: { maxSeqLen: row.input.maxSeqLen }, assignment: { attemptId: 'physical-decision-' + row.id },
    limits: { maxInputBytes: 10000, maxOutputBytes: 10000, deadlineAt: Date.now() + 60000 } });
  for (const row of qualification.reference.cases) {
    const result = await provider.execute(request(row));
    const maxError = Math.max(...result.output.choices.map((choice, index) => Math.abs(choice.logit - row.output.choices[index].logit)));
    assert.equal(result.output.selectedId, row.expectedId, row.id);
    assert(maxError <= qualification.reference.maximumAbsoluteLogitError, `${row.id}: independent logits differ`);
    report.cases.push({ id: row.id, output: result.output, evidence: result.evidence, maximumAbsoluteLogitError: maxError });
  }
  const first = qualification.reference.cases[0];
  assert.equal((await provider.execute(request(first, 'doppler.capsule-operation-request/v1'))).output.selectedId, first.expectedId);
  report.checks.push({ id: 'v1-and-v2-completion-verification', passed: true });
  const controller = new AbortController(); controllerAfterSubmit = controller;
  await assert.rejects(provider.execute(request(first), { signal: controller.signal }), /cancel|abort/i);
  assert(controller.signal.aborted);
  for (const device of devices) if (!destroyed.has(device)) await device.queue.onSubmittedWorkDone();
  report.checks.push({ id: 'real-submission-cancellation-settled', passed: true });
  assert.equal((await provider.execute(request(first))).output.selectedId, first.expectedId);
  report.checks.push({ id: 'reusable-weights-after-cancellation', passed: true });
  await assert.rejects(session.generateText({ prompt: 'hello', maxTokens: 1 }), /not qualified/);
  report.checks.push({ id: 'decision-evidence-does-not-authorize-generation', passed: true });
  report.passed = true;
} catch (error) { report.failure = String(error.stack || error); }
finally {
  try {
    await provider?.close(); await session?.close();
    for (const device of devices) if (!destroyed.has(device)) { await device.queue.onSubmittedWorkDone(); device.destroy(); }
    report.checks.push({ id: 'provider-and-session-closed', passed: true });
  } catch (error) { report.cleanupFailure = String(error.stack || error); report.passed = false; }
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ outputPath, passed: report.passed, cases: report.cases.length, failure: report.failure ?? null }));
}
// The owned provider process ends after GPU settlement and durable evidence.
process.exit(report.passed ? 0 : 1);
