// Pipeline creation cost of one WGSL program specialization, in a fresh process on one physical
// GPU through Node/Dawn: wall time of shader module creation plus compute pipeline creation, and
// the process resident-memory high-water mark (Linux VmHWM) before and after. RADV compiles in
// the calling process, so the high-water-mark increase bounds the compiler's extra memory.
// Run with MESA_SHADER_CACHE_DISABLE=true for a cold compile; without it, a second run measures
// the driver-cache-warm path.
//
// Usage: node compile-cost.mjs <webgpu module dir> <program.wgsl> <constants JSON> <label>
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const [moduleDir, wgslPath, constantsArg, label] = process.argv.slice(2);
if (!label) throw new Error('Usage: compile-cost.mjs WEBGPU WGSL CONSTANTS LABEL');
const { create, globals } = createRequire(import.meta.url)(moduleDir);
Object.assign(globalThis, globals);
const status = async () => {
  const text = await readFile('/proc/self/status', 'utf8');
  const field = name => Number(text.match(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm'))?.[1] ?? NaN);
  return { vmHWMKiB: field('VmHWM'), vmRSSKiB: field('VmRSS') };
};
const code = await readFile(wgslPath, 'utf8');
const constants = JSON.parse(constantsArg);
const gpu = globalThis.dawnInstance = create([]);
const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
const device = await adapter.requestDevice({ requiredFeatures: adapter.features.has('shader-f16') ? ['shader-f16'] : [] });
const errors = [];
device.addEventListener?.('uncapturederror', event => errors.push(event.error.message));
const before = await status();
const started = performance.now();
const module = device.createShaderModule({ code });
const messages = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error').map(row => row.message);
await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main', constants } });
const ms = performance.now() - started;
const after = await status();
console.log(JSON.stringify({ label, wgsl: wgslPath.split('/').at(-1), constants, cacheDisabled: process.env.MESA_SHADER_CACHE_DISABLE === 'true',
  ms, before, after, hwmIncreaseMiB: (after.vmHWMKiB - before.vmHWMKiB) / 1024, errors: [...messages, ...errors] }));
device.destroy();
process.exit(0);
