import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalize, canonicalizeWith } from '../../shared/vendor/reploid/artifacts/canonical-json.js';
import { REVERSE_PROMPT_GENERATION_HASH } from '../../shared/infrastructure/reverse-prompt-profile.js';
import { PROFILE, RULE_VERSION, bannedFor, dayUTC, judgePrompt, scoreOutput } from './rules.js';

export const CALENDAR_SCHEMA = 'reploid.daily-calendar/v1';
export const QUALIFICATION_SCHEMA = 'reploid.daily-qualification/v1';
const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
const dopplerJson = canonicalizeWith((a, b) => a.localeCompare(b));
export const dopplerHash = value => hash(dopplerJson(value));
const same = (a, b) => a !== undefined && b !== undefined && canonicalize(a) === canonicalize(b);
const peer = /^peer:[a-f0-9]{24}$/;
// The DopplerX release Reploid pins; qualifications must come from that exact runtime (its archive is PROFILE.runtimeArchive).
const PINNED_RUNTIME = Object.freeze({package: 'dopplerx', surface: 'node',
  version: JSON.parse(readFileSync(new URL('../../shared/config/doppler-package.json', import.meta.url), 'utf8')).version});
const digest = /^sha256:[a-f0-9]{64}$/;

function validatedDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && dayUTC(Date.parse(value)) === value;
}
function validTarget(target) {
  return typeof target === 'string' && target === target.trim() && target.length > 0 && target.length <= 120
    && !/[\p{C}\p{M}]/u.test(target) && bannedFor(target).length > 0;
}

function readSigned(envelope, schema, key) {
  if (!key || envelope?.schema !== schema || typeof envelope.signature !== 'string') return null;
  const {signature, ...body} = envelope;
  return verify(null, Buffer.from(canonicalize(body)), key, Buffer.from(signature, 'base64')) ? body : null;
}

function physicalVendor(identity, nativeBackend) {
  if (identity?.backend !== 'webgpu') return null;
  const {vendor, device, architecture, description} = identity.adapter ?? {};
  if (!vendor || !(device || architecture) || /software|swiftshader|llvmpipe|lavapipe|warp\b|cpu\b/i.test([vendor, device, architecture, description].join(' '))) return null;
  // Some native AMD drivers report only a vendor-specific string. The collector explicitly
  // selects Dawn's Vulkan backend on that host and signs the selection with the raw evidence.
  const detail = [architecture, description].join(' ');
  let reportedApi = null;
  if (/\bmetal\b/i.test(detail)) reportedApi = 'metal';
  else if (/\b(vulkan|radv|amdvlk)\b/i.test(detail)) reportedApi = 'vulkan';
  else if (/\b(direct3d|d3d11|d3d12|opengl|gles)\b/i.test(detail)) reportedApi = 'other';
  if (reportedApi && nativeBackend && reportedApi !== nativeBackend) return null;
  const api = reportedApi ?? nativeBackend;
  if (/^(apple|0x106b)$/i.test(vendor)) return api === 'metal' ? 'apple' : null;
  if (/^(amd|advanced micro devices(?:,? inc\.?)?|0x1002)$/i.test(vendor)) return api === 'vulkan' ? 'amd' : null;
  if (/^(nvidia(?: corporation)?|0x10de)$/i.test(vendor)) return 'nvidia';
  if (/^(intel(?: corporation)?|0x8086)$/i.test(vendor)) return 'intel';
  if (/^(qualcomm|0x5143)$/i.test(vendor)) return 'qualcomm';
  if (/^(arm|0x13b5)$/i.test(vendor)) return 'arm';
  return null;
}

function pinnedRuntime(evidence) {
  const {runtimeProfile, generationConfig, backendIdentity} = evidence;
  const model = runtimeProfile?.model;
  return runtimeProfile?.schema === 'doppler_runtime_profile/v1'
    && same(runtimeProfile.runtime, PINNED_RUNTIME)
    && model?.modelId === PROFILE.modelId && model.manifestHash === PROFILE.modelIdentity
    && model.activeAdapter == null && model.activeAdapterId == null && model.activeAdapterDigest == null
    && same(runtimeProfile.backendIdentity, backendIdentity)
    && evidence.runtimeProfileHash === dopplerHash(runtimeProfile)
    && evidence.backendIdentityHash === dopplerHash(backendIdentity)
    && generationConfig && evidence.generationConfigHash === REVERSE_PROMPT_GENERATION_HASH
    && evidence.generationConfigHash === dopplerHash(generationConfig);
}

function completedTranscript({evidence, completion}) {
  const trace = evidence.transcript;
  return trace?.schema === 'doppler_generation_transcript/v1' && typeof trace.outputText === 'string'
    && Array.isArray(trace.tokenIds) && trace.tokenIds.every(id => Number.isSafeInteger(id) && id >= 0)
    && evidence.transcriptHash === dopplerHash(trace)
    && completion?.schema === 'doppler.generation-completion/v1'
    && Number.isSafeInteger(completion.promptTokenCount) && completion.promptTokenCount > 0
    && completion.generatedTokenCount === trace.tokenIds.length && trace.tokenIds.length <= PROFILE.maxOutputTokens;
}

export function measuredOutput(row, {nativeBackend} = {}) {
  if (!row || row.reusedPrefixTokens !== 0) return null;
  const evidence = row.evidence;
  const vendor = physicalVendor(evidence?.backendIdentity, nativeBackend);
  if (!vendor || evidence.schema !== 'doppler_generation_evidence/v1' || !pinnedRuntime(evidence)
    || !completedTranscript(row)) return null;
  return {output:evidence.transcript.outputText, vendor, backend:evidence.backendIdentityHash};
}

export function measuredAttempt(row, options) {
  if (!row || !validTarget(row.target)) return null;
  const {target, prompt} = row;
  const physical = measuredOutput(row, options);
  if (!physical || !scoreOutput(physical.output, target)) return null;
  try {
    const judged = judgePrompt(prompt, target);
    // Cosmetic variants (casing, punctuation, spacing and accents) count as one solution.
    const wording = judged.prompt.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu).join(' ');
    return {target, wording, vendor:physical.vendor, backend:physical.backend};
  } catch { return null; }
}

export function createDailyCalendar({schedule, qualifications = [], calendarPublicKey, providerId, backendIdentityHash, previewTarget, now = Date.now} = {}) {
  const key = calendarPublicKey ? createPublicKey(calendarPublicKey) : null;
  if (key && key.asymmetricKeyType !== 'ed25519') throw Error('Daily calendar requires an Ed25519 public key');
  const calendar = readSigned(schedule, CALENDAR_SCHEMA, key);
  const scheduled = new Map();
  for (const [day, target] of Object.entries(calendar?.days ?? {})) {
    if (!validatedDay(day) || !validTarget(target)) throw Error('Invalid day or target in signed daily calendar');
    scheduled.set(day,target);
  }
  const targets = new Map();
  for (const envelope of qualifications) {
    const report = readSigned(envelope, QUALIFICATION_SCHEMA, key);
    if (!report || !same(report.profile, PROFILE) || report.ruleVersion !== RULE_VERSION
      || !(report.providerId === null || peer.test(report.providerId)) || !Array.isArray(report.attempts)) continue;
    for (const row of report.attempts) {
      const hit = measuredAttempt(row, {nativeBackend:report.nativeBackend});
      if (!hit) continue;
      if (!targets.has(hit.target)) targets.set(hit.target, new Map());
      const lanes = targets.get(hit.target);
      const id = JSON.stringify([hit.vendor,hit.backend,report.providerId]);
      if (!lanes.has(id)) lanes.set(id, {...hit, provider:report.providerId, wordings:new Set()});
      lanes.get(id).wordings.add(hit.wording);
    }
  }
  return Object.freeze({gameForDay(day) {
    if (!validatedDay(day)) throw Error('Invalid UTC challenge date');
    const scheduledTarget = scheduled.get(day);
    const target = scheduledTarget ?? (day === dayUTC(now()) && validTarget(previewTarget) ? previewTarget : null);
    if (target === null) return null;
    const lanes = [...(targets.get(target)?.values() ?? [])].filter(lane => lane.wordings.size >= 2);
    const qualified = Boolean(scheduledTarget && peer.test(providerId) && digest.test(backendIdentityHash)
      && lanes.some(lane => lane.vendor === 'apple') && lanes.some(lane => lane.vendor === 'amd')
      && lanes.some(lane => lane.provider === providerId && lane.backend === backendIdentityHash));
    const descriptor = {day,target,banned:bannedFor(target),modelId:PROFILE.modelId,
      modelIdentity:PROFILE.modelIdentity,ruleVersion:RULE_VERSION};
    const circlePin = {descriptor, providerId:providerId ?? null, backendIdentityHash:backendIdentityHash ?? null,
      profile:PROFILE, generationConfigHash:REVERSE_PROMPT_GENERATION_HASH};
    return {...descriptor, qualified, digest:hash(canonicalize(circlePin))};
  }});
}
