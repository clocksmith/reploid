// @vitest-environment node
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import { test } from 'vitest';
import {canonicalize} from '../../packages/reploid/src/artifacts/canonical-json.js';
import {CALENDAR_SCHEMA, QUALIFICATION_SCHEMA, createDailyCalendar, dopplerHash} from '../../server/daily/challenges.js';
import {PROFILE, RULE_VERSION} from '../../server/daily/rules.js';
import {REVERSE_PROMPT_GENERATION} from '../../shared/infrastructure/reverse-prompt-profile.js';
import {readFileSync} from 'node:fs';
const PINNED_VERSION = JSON.parse(readFileSync(new URL('../../shared/config/doppler-package.json', import.meta.url), 'utf8')).version;

const key = generateKeyPairSync('ed25519');
const calendarPublicKey = key.publicKey.export({type:'spki',format:'pem'});
const signed = body => ({...body, signature:sign(null,Buffer.from(canonicalize(body)),key.privateKey).toString('base64')});
const target = 'Test fixture';
const day = '2000-01-01';
const providerId = 'peer:' + 'ab'.repeat(12);
const schedule = signed({schema:CALENDAR_SCHEMA,days:{[day]:target}});
function backend(vendor) {
  return {backend:'webgpu',adapter:{vendor, device:'synthetic-unit-case', architecture:'unit'}};
}
const generationConfig = {...REVERSE_PROMPT_GENERATION, suppressTokenIds:[],greedyThreshold:0.01,
  suppressSpecialTokens:false,suppressSpecialLikeTokens:false,
  speculation:{mode:'self',tokens:1,verify:'greedy',threshold:null,rollbackOnReject:true},seed:null};
function attempt(vendor, prompt, outputText = target) {
  const backendIdentity = backend(vendor);
  const runtimeProfile = {schema:'doppler_runtime_profile/v1',runtime:{package:'dopplerx',version:PINNED_VERSION,surface:'node'},
    model:{modelId:PROFILE.modelId,manifestHash:PROFILE.modelIdentity,activeAdapter:null,activeAdapterId:null,activeAdapterDigest:null},backendIdentity};
  const transcript = {schema:'doppler_generation_transcript/v1',outputText,tokenIds:[1,2]};
  return {target,prompt,reusedPrefixTokens:0, completion:{schema:'doppler.generation-completion/v1',stopReason:'stop-token',
    promptTokenCount:10,generatedTokenCount:2},evidence:{schema:'doppler_generation_evidence/v1',backendIdentity,
    backendIdentityHash:dopplerHash(backendIdentity),generationConfig,generationConfigHash:dopplerHash(generationConfig),
    transcript,transcriptHash:dopplerHash(transcript),runtimeProfile,runtimeProfileHash:dopplerHash(runtimeProfile)}};
}
const first = 'Independent sample alpha', second = 'Unique framing beta';
const report = (attempts,provider,api = attempts[0]?.evidence.backendIdentity.adapter.vendor === 'apple' ? 'metal' : 'vulkan') =>
  signed({schema:QUALIFICATION_SCHEMA,ruleVersion:RULE_VERSION,profile:PROFILE,providerId:provider,nativeBackend:api,attempts});
const apple = report([attempt('apple',first),attempt('apple',second)],providerId);
const amd = report([attempt('amd',first),attempt('amd',second)],null);
const config = {calendarPublicKey,providerId,backendIdentityHash:dopplerHash(backend('apple')),schedule,qualifications:[apple,amd]};
const game = (changes = {}) => createDailyCalendar({...config,...changes}).gameForDay(day);

test('only independently evidenced Apple, AMD and the circle backend enable the signed date', () => {
  assert.equal(game().qualified,true);
  assert.equal(game({qualifications:[apple]}).qualified,false);
  assert.equal(game({qualifications:[amd]}).qualified,false);
  assert.equal(game({providerId:'peer:'+'cd'.repeat(12)}).qualified,false);
  assert.equal(game({backendIdentityHash:dopplerHash(backend('amd'))}).qualified,false);
  assert.notEqual(game({backendIdentityHash:dopplerHash(backend('amd'))}).digest,game().digest);
  assert.notEqual(game({providerId:'peer:'+'cd'.repeat(12)}).digest,game().digest);
  assert.equal(JSON.stringify(game()).includes(first),false);
  assert.equal(JSON.stringify(game()).includes(providerId),false);
});
test('AMD on Metal, Apple on Vulkan, and ambiguous driver descriptions without a selection cannot qualify', () => {
  for (const badAmd of ['metal',null]) {
    assert.equal(game({qualifications:[apple,report([attempt('amd',first),attempt('amd',second)],null,badAmd)]}).qualified,false);
  }
  assert.equal(game({qualifications:[report([attempt('apple',first),attempt('apple',second)],providerId,'vulkan'),amd]}).qualified,false);
});

test('an additional hosting GPU needs its own two results alongside the Apple and AMD references', () => {
  const circleGpu = dopplerHash(backend('nvidia'));
  const referenceApple = report([attempt('apple',first),attempt('apple',second)],null);
  const own = report([attempt('nvidia',first),attempt('nvidia',second)],providerId);
  assert.equal(game({backendIdentityHash:circleGpu,qualifications:[referenceApple,amd,own]}).qualified,true);
  assert.equal(game({backendIdentityHash:circleGpu,qualifications:[referenceApple,amd]}).qualified,false);
  assert.equal(game({backendIdentityHash:circleGpu,qualifications:[amd,own]}).qualified,false);
});

test('unsigned, unmapped and altered calendars cannot accept turns; today can preview', () => {
  assert.equal(game({schedule:{schema:CALENDAR_SCHEMA,days:{[day]:target}}}),null);
  assert.equal(game({schedule:{...schedule,days:{[day]:'Other'}}}),null);
  const calendar = createDailyCalendar({...config,schedule:undefined, previewTarget:target, now:()=>Date.parse(day)});
  assert.equal(calendar.gameForDay(day).qualified,false);
  assert.equal(calendar.gameForDay('2000-01-02'),null);
  assert.equal(createDailyCalendar(config).gameForDay('2000-01-02'),null);
  assert.throws(()=>calendar.gameForDay('2000-02-31'),/Invalid/);
});
test('boolean, tampered, cosmetically repeated, forbidden and mismatched outputs are insufficient', () => {
  const failures = [
    {schema:QUALIFICATION_SCHEMA, qualified:true},
    {...amd,providerId},
    report([attempt('amd',first),attempt('amd',first.toUpperCase()+'!')],null),
    report([attempt('amd',first),attempt('amd','T.e.s.t this')],null),
    report([attempt('amd',first),attempt('amd',second,'Wrong')],null),
    report([attempt('amd',first),{...attempt('amd',second),reusedPrefixTokens:2}],null)
  ];
  for (const invalid of failures) assert.equal(game({qualifications:[apple,invalid]}).qualified,false);
});
test('measured output, hardware and decoding hashes and signed profile are checked', () => {
  for (const change of [
    row => {row.evidence.transcript.outputText='nonmatch';},
    row => {row.evidence.backendIdentityHash='sha256:'+'1'.repeat(64);},
    row => {row.evidence.generationConfigHash='sha256:'+'2'.repeat(64);},
    row => {row.evidence.runtimeProfileHash='sha256:'+'3'.repeat(64);},
    row => {row.completion.generatedTokenCount=17;},
    row => {row.evidence.backendIdentity.adapter.description='llvmpipe software';}
  ]) {
    const row = structuredClone(attempt('amd',second));change(row);
    assert.equal(game({qualifications:[apple,report([attempt('amd',first),row],null)]}).qualified,false);
  }
  const {signature,...body} = amd;
  const different = signed({...body,profile:{...PROFILE,thinking:true}});
  assert.equal(game({qualifications:[apple,different]}).qualified,false);
});
