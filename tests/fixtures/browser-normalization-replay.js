/** Replay the captured layer-zero row and exact packed weights, independently of
 * model execution. Experimental shaders never enter an inference runtime. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const { DOPPLER_SOURCE_ROOT: root, REPLOID_CAPTURE_INPUT: input,
  REPLOID_CAPTURE_OUT: output, REPLOID_EXECUTOR_WS: remote } = process.env;
assert(root && input && output && remote, 'Source root, captured operands, output and remote browser are required');
const capture = JSON.parse(await readFile(input, 'utf8'));
const operands = capture.inputObservations[0];
const decode = (role, dtype, Type) => {
  const item = operands.find(item => item.role === role);
  assert.equal(item.dtype, dtype);
  const bytes = Buffer.from(item.data, 'base64');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
  return Array.from(new Type(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
};
const source = await readFile(resolve(root, 'src/gpu/kernels/rmsnorm.wgsl'), 'utf8');
const diagnostic = await readFile(resolve(root, 'tests/kernels/rmsnorm-platform-diagnostic.js'), 'utf8');
const request = { source, input: decode('input-last-row', 'f32', Float32Array),
  weights: decode('weight', 'f16', Uint16Array), epsilon: 1e-6, weightOffset: true, weightDtype: 'f16',
  experiment: process.env.DOPPLER_RMS_EXPERIMENT ?? null };
const results = [];
for (const platform of ['mac', 'linux']) {
  const browser = platform === 'mac' ? await chromium.launch({ headless: true,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal'] }) : await chromium.connect(remote);
  let context;
  try {
    context = await browser.newContext();
    await context.route('**/normalization-replay-diagnostic.js', route => route.fulfill({
      contentType: 'text/javascript', body: diagnostic }));
    const page = await context.newPage();
    await page.goto('http://localhost:8000/config/chat-files.json');
    for (const entryPoint of request.experiment ? ['main'] : ['main', 'main_subgroup']) {
      const result = await page.evaluate(async request => {
        const { diagnoseRMSNorm } = await import('/normalization-replay-diagnostic.js');
        return diagnoseRMSNorm(request);
      }, { ...request, entryPoint });
      results.push({ platform, browser: browser.version(), entryPoint, ...result });
    }
  } finally { await context?.close(); await browser.close(); }
}
await writeFile(output, JSON.stringify({ scope: 'Isolated identical-operand replay; not model qualification',
  shaderSha256: createHash('sha256').update(source).digest('hex'),
  diagnosticSha256: createHash('sha256').update(diagnostic).digest('hex'),
  operands: operands.map(({ data, ...identity }) => identity), results }));
console.log(JSON.stringify({ output, runs: results.length }));
