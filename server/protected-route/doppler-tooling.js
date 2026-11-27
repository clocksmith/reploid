/**
 * Where the protected route's engine comes from: Doppler's JavaScript protected tooling (`tools/privacy-protected` on
 * the Doppler branches `protected-route-js` / `protected-he-split-js`). Doppler owns the CKKS scheme, the circuit, the
 * compiled programs and the WebGPU kernels; Reploid only drives its command line and reads its public constants:
 *
 *   pp.js bridge                       the requester's key holder (doppler-key-holder.js)
 *   webgpu/evaluator.js                the WebGPU evaluator, whole or one stage of the homomorphic split (doppler-evaluator.js)
 *   pp.js gpu-compile | reference | trap-oracle | trapset   programs, pins and traps
 *
 * Nothing here runs unless a host names a Doppler checkout. It is never a default.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const DOPPLER_PROTECTED_UNAVAILABLE = 'PROTECTED_DOPPLER_UNAVAILABLE';

/** Paths of a Doppler checkout's protected tooling. Refuses a directory without it. */
export function resolveDopplerProtected(doppler) {
  const tools = doppler && path.resolve(doppler, existsSync(path.join(doppler, 'pp.js')) ? '.' : 'tools/privacy-protected');
  const paths = tools && { tools, pp: path.join(tools, 'pp.js'), evaluator: path.join(tools, 'webgpu/evaluator.js'), model: path.join(tools, 'tiny-model.json') };
  if (!paths || !Object.values(paths).every(file => existsSync(file))) {
    throw Object.assign(new Error(`No Doppler protected tooling at ${doppler ?? '(none given)'}: name a Doppler checkout with tools/privacy-protected `
      + '(branch protected-route-js)'), { code: DOPPLER_PROTECTED_UNAVAILABLE });
  }
  return Object.freeze(paths);
}

/** Run one `pp.js` subcommand with this Node and parse its JSON stdout. */
export async function runDopplerTool(doppler, args, { timeoutMs = 120000 } = {}) {
  const { pp } = resolveDopplerProtected(doppler);
  const { stdout } = await run(process.execPath, [pp, ...args], { timeout: timeoutMs, maxBuffer: 64 << 20 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

/**
 * The engine manifest an evaluator peer advertises, from Doppler's own constants: profile and its digest, model
 * identity and circuit digest, geometry, input level, slot count and rotations. Shape and pins only; nothing here makes
 * a backend eligible (the requester's allowlist decides).
 */
export async function describeDopplerEngine({ doppler, profile, model = null, triage = false, maxLanes = 8, implementation = 'doppler-webgpu-evaluator' }) {
  const { tools, model: defaultModel } = resolveDopplerProtected(doppler);
  const load = file => import(pathToFileURL(path.join(tools, file)).href);
  if (triage) {
    const { describeTriage } = await load('tools.js');
    const descriptor = describeTriage(model ?? undefined);
    if (profile !== descriptor.profile) throw new Error('Profile differs from the pinned ticket triage profile');
    return Object.freeze({ ...descriptor, implementation, maxLanes });
  }
  const [plan, params] = await Promise.all([load('plan.js'), load('ckks/params.js')]);
  const p = params.lookupProfile(profile);
  if (p.wire !== params.WIRE_RAW_U32) throw new Error(`Profile ${profile} is not a WebGPU (u32) profile`);
  const modelPath = model ?? defaultModel;
  const { model: weights, id } = plan.loadModel(modelPath);
  const fileIdentity = 'sha256:' + createHash('sha256').update(await readFile(modelPath)).digest('hex');
  if (fileIdentity !== id) throw new Error('Doppler\'s model identity is not the digest of the model file');
  return Object.freeze({
    protocol: plan.PROTOCOL_ID, implementation, scheme: 'ckks-rns', profile: p.id, profileDigest: p.digest, insecureDevelopment: Boolean(p.insecure),
    circuit: plan.circuitDigest(plan.newPlan(weights), id), model: id, vocab: plan.VOCAB, context: plan.CONTEXT, inputLevel: p.maxLevel,
    logSlots: plan.LOG_SLOTS, rotations: Object.freeze([...params.ROTATIONS]), maxLanes, alphabet: plan.ALPHABET
  });
}

/** Doppler's pinned continuation of a prompt: the approximate circuit's greedy tokens and the float64 model's. */
export const dopplerReference = ({ doppler, model = null, prompt, generate }) => runDopplerTool(doppler,
  ['reference', ...(model ? ['--model', model] : []), '--prompt', prompt, '--generate', String(generate)]);

/**
 * Compile the WebGPU session program for a prompt length and generated count (`pp.js gpu-compile`): a prefill step and
 * a decode step for every later position. Returns the program base path.
 */
export async function compileDopplerProgram({ doppler, profile, promptTokens, generatedTokens, out, model = null, triage = false }) {
  await runDopplerTool(doppler, ['gpu-compile', '--profile', profile, ...(triage ? ['--triage'] : []), ...(model ? ['--model', model] : []), '--positions', String(promptTokens),
    '--decode-through', String(promptTokens + generatedTokens - 2), '--out', out], { timeoutMs: 600000 });
  return out;
}
