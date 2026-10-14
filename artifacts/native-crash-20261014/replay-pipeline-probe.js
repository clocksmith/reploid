// Replays the Oct 13 probe's pipeline creation (same Dawn build, shader, layout and limits)
// against MESA_SHADER_CACHE_DIR, recording phases. Creates a pipeline; dispatches nothing.
import { appendFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, shader, log, label] = process.argv.slice(2);
const t0 = performance.now();
const mark = (phase, fields = {}) => appendFileSync(log, JSON.stringify({ label, phase, ms: Math.round(performance.now() - t0),
  pid: process.pid, cache: process.env.MESA_SHADER_CACHE_DIR || null, ...fields }) + '\n');
const { createNativeGpuHost } = await import(pathToFileURL(resolve(root, 'server/native-participant.js')));
const host = createNativeGpuHost(() => import(pathToFileURL(resolve(root, 'node_modules/webgpu/index.js'))));
try {
  await host.open(); mark('host-open');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: 9 } });
  const module = device.createShaderModule({ code: readFileSync(shader, 'utf8') });
  const errors = (await module.getCompilationInfo()).messages.filter(row => row.type === 'error');
  mark('shader-module-complete', { errors: errors.length });
  mark('pipeline-start');
  await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } });
  mark('pipeline-complete');
} catch (error) { mark('error', { message: String(error?.message || error).slice(0, 300) }); process.exitCode = 1; }
finally { try { await host.close(); mark('host-close-complete'); } catch (error) { mark('host-close-failed', { message: error.message }); } }
