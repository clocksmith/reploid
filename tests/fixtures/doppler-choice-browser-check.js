// Isolated browser qualification; real weights, installed public Doppler APIs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep, dirname } from 'node:path';
import { chromium } from 'playwright';
import { computeCanonicalSha256 } from '../../../doppler/src/formats/canonical-hash.js';
import { hashStableJson } from '../../../doppler/src/tooling/program-bundle/materialize.js';
import { assertChoiceScoringReferenceTranscript } from '../../../doppler/src/config/choice-scoring-reference.js';

const [packageRootArg, modelDirArg, contractPath, referencePath, archivePath, outputPath] = process.argv.slice(2);
assert(outputPath, 'Expected installed package, model, contract, independent reference, archive and output');
const packageRoot = resolve(packageRootArg), modelDir = resolve(modelDirArg), root = resolve(import.meta.dirname, '../..');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = await read(resolve(packageRoot, 'package.json'));
const contract = await read(contractPath), reference = await read(referencePath);
const manifestBytes = await readFile(resolve(modelDir, 'manifest.json')), manifest = JSON.parse(manifestBytes);
assert.equal(reference.contractSha256, sha(await readFile(contractPath)));
assert.equal(sha(manifestBytes), contract.manifestSha256);
assert.equal(reference.modelManifestSha256, contract.manifestSha256);
const report = { schema: 'doppler.choice-scoring-physical/v1', passed: false,
  archiveSha256: sha(await readFile(archivePath)), runtimeVersion: metadata.version,
  contractSha256: reference.contractSha256, referenceSha256: sha(await readFile(referencePath)),
  manifestSha256: contract.manifestSha256, modelId: contract.modelId, logs: [] };
const imports = Object.fromEntries(['.', './compat'].map(key => {
  const entry = metadata.exports[key].browser ?? metadata.exports[key].import;
  return [key === '.' ? 'doppler-gpu' : 'doppler-gpu/compat', '/installed/' + entry.slice(2)];
}));
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Physical decision qualification</title><script type="importmap">'
        + JSON.stringify({ imports }) + '</script>'); return; }
    const mapping = pathname.startsWith('/installed/') ? [packageRoot, pathname.slice(11)]
      : pathname.startsWith('/model/') ? [modelDir, pathname.slice(7)]
      : [resolve(root, 'tests/fixtures'), pathname.replace(/^\/tests\/fixtures\//, '')];
    const file = resolve(mapping[0], mapping[1]);
    if (!file.startsWith(mapping[0] + sep)) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.bin') ? 'application/octet-stream' : 'text/javascript');
    const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response);
  } catch { response.writeHead(404).end(); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.REPLOID_E2E_CHROMIUM_CHANNEL || 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'] });
  report.browserVersion = browser.version();
  const page = await browser.newPage();
  page.on('console', message => report.logs.push({ type: message.type(), message: message.text() }));
  page.on('pageerror', error => report.logs.push({ type: 'pageerror', message: error.message }));
  await page.goto(origin);
  Object.assign(report, await page.evaluate(async input => {
    const fixture = await import('/tests/fixtures/doppler-choice-browser.js');
    return fixture.qualify(input);
  }, { modelUrl: origin + '/model/', reference, contract }));
  assert.equal(report.passed, true, report.failure || 'Browser numerical or task gate failed');
} catch (error) { report.failure ||= String(error.stack || error); report.passed = false; }
finally {
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
}
if (report.passed) {
  const sourceReference = { schema: 'doppler.choice-scoring-source-reference/v1', engine: reference.implementation,
    engineVersions: reference.versions, contractHash: `sha256:${reference.contractSha256}`,
    manifestHash: `sha256:${contract.manifestSha256}`, maximumAbsoluteLogitError: contract.maximumAbsoluteLogitError,
    minimumCorrectChoices: contract.minimumCorrectChoices, cases: reference.cases.map(row => ({ id: row.id,
      input: { prompt: row.prompt, choices: contract.choices, maxSeqLen: contract.maxSeqLen },
      expectedId: row.expectedId, promptTokenIds: row.promptTokenIds,
      output: { schema: 'doppler.choice-scores/v1', interpretation: 'next-token-logits', calibration: null,
        choices: contract.choices.map((choice, index) => ({ ...choice, tokenId: row.tokenIds[index], logit: row.logits[index] })),
        selectedId: row.selectedId, promptTokenCount: row.promptTokenIds.length } })) };
  const qualification = { schema: 'doppler.choiceScoringModelQualification.v1', passed: true,
    model: { modelId: contract.modelId, manifestHash: `sha256:${contract.manifestSha256}` },
    runtime: { surface: 'browser-webgpu', executionGraphHash: hashStableJson(manifest.inference.execution),
      adapterInfo: report.deviceInfo, archiveSha256: report.archiveSha256 }, reference: sourceReference,
    referenceDigest: computeCanonicalSha256(sourceReference), observation: { cases: report.cases.map(({ id, input, output, promptTokenIds, expectedId }) =>
      ({ id, input, output, promptTokenIds, expectedId })) } };
  assertChoiceScoringReferenceTranscript({ schema: 'doppler.choice-scoring-reference-transcript/v1', operation: 'scoreChoices',
    modelId: contract.modelId, manifestHash: qualification.model.manifestHash, surface: qualification.runtime.surface,
    executionGraphHash: qualification.runtime.executionGraphHash, source: { kind: 'physical-test', path: outputPath,
      hash: `sha256:${sha(await readFile(outputPath))}` }, reference: sourceReference,
    referenceDigest: qualification.referenceDigest, observation: qualification.observation });
  await writeFile(outputPath + '.qualification.json', JSON.stringify(qualification, null, 2) + '\n');
}
console.log(JSON.stringify({ outputPath, passed: report.passed, cases: report.cases?.length, failure: report.failure ?? null }));
if (!report.passed) process.exitCode = 1;
