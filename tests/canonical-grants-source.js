// Explicit source capability; does not change the accepted Doppler package.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createSigningIdentity} from '../packages/reploid/src/artifacts/identity.js';
import {createPartitionGrantAuthority} from '../packages/reploid/src/mesh/partitions/partition-grants.js';
const root=process.env.DOPPLER_SOURCE_ROOT;assert(root,'Explicit source root required');
const runtime=await import(pathToFileURL(root+'/src/partitions.js'));
const basePolicy=JSON.parse(await readFile(root+'/tests/fixtures/canonical-generation-policy.json','utf8'));
const keys=await Promise.all([0,1].map(()=>createSigningIdentity({algorithm:'ECDSA'})));
const hash='sha256:'+'a'.repeat(64),other='sha256:'+'b'.repeat(64),epoch='0'.repeat(32);
const binding={modelId:'model',modelIdentity:hash,planId:hash,threadId:'thread',attemptId:'attempt',
 participantA:keys[0].peerId,participantB:keys[1].peerId,requesterId:'requester',placementGeneration:0};
const limits={maxTokens:16,maxPromptTokens:64,maxActivationBytes:4096,maxOutputCharacters:1024};
let time=10;
const options={identity:keys[0],meshId:'mesh',maxGrants:20,maxTtlMs:1000,now:()=>time,canonicalRuntime:runtime};
const authority=createPartitionGrantAuthority(options),remote=createPartitionGrantAuthority({...options,identity:keys[1]});
const disclosure='partition-activations-and-tokens';
function context(policy=basePolicy) {
 const generation=runtime.canonicalGenerationIdentity(policy,hash,100);
 const authorizationScope=authority.canonicalScope({identity:binding,limits,disclosure,generationId:generation.generationId});
 const canonicalAttempt={schema:'doppler.resident-attempt/v2',attemptId:binding.attemptId,requesterId:binding.requesterId,inputDigest:hash,
  authorizationScope,routeId:hash,generationId:generation.generationId,coordinatorEpoch:epoch,publisherEpoch:epoch,routeKind:'two-stage-layer',
  stages:keys.map((key,index)=>({stageId:index?other:hash,participantId:key.peerId,participantEpoch:epoch,deviceEpoch:epoch,
   residentId:'resident'+index,partitionIndex:index,executionId:hash}))};
 return {generation,canonicalAttempt};
}
const current=context();
const request={identity:binding,canonicalAttempt:current.canonicalAttempt,generationId:current.generation.generationId,
 action:'mesh.execute_partition_b',phase:'admit',step:0,inputTokenCount:2,activationBytes:0};
const issue=value=>authority.issueCanonical(binding,limits,{approved:true,ttlMs:100,disclosure,...value,vocabSize:100});
const grant=await issue(current);
assert.equal(grant.claim.schema,'reploid.partition-grant/v3');
assert.equal(await remote.verify(grant,request),true);
assert.equal(await remote.verify(grant,{...request,phase:'step',activationBytes:64}),true);
for(const change of [{phase:'unknown'},{generationId:other},{step:16,phase:'step'},{inputTokenCount:65},
 {inputTokenCount:2,step:1,phase:'step'},{activationBytes:4097,phase:'step'},
 {canonicalAttempt:{...current.canonicalAttempt,coordinatorEpoch:'1'.repeat(32)}}]) {
 assert.equal(await remote.verify(grant,{...request,...change}),false);
}
for(const mutate of [value=>{value.claim.generation.policy.materializedInputCapacity++;},value=>{value.claim.extra=true;},
 value=>{value.claim.limits.maxOutputCharacters++;},value=>{value.claim.canonicalAttempt.stages[1].deviceEpoch='1'.repeat(32);}]) {
 const changed=structuredClone(grant);mutate(changed);assert.equal(await remote.verify(changed,request),false);
}
await assert.rejects(issue({...current,canonicalAttempt:{...current.canonicalAttempt,authorizationScope:other}}),/scope/);
await assert.rejects(issue({...current,canonicalAttempt:{...current.canonicalAttempt,requesterId:'other'}}),/binding/);
const noTokens=context({...basePolicy,maxGeneratedTokens:0});const zero=await issue(noTokens);
const zeroRequest={...request,canonicalAttempt:noTokens.canonicalAttempt,generationId:noTokens.generation.generationId};
assert.equal(await remote.verify(zero,zeroRequest),true);
assert.equal(await remote.verify(zero,{...zeroRequest,phase:'step'}),false,'zero-output cannot authorize dispatch');
assert.equal(await remote.verify(zero,{...zeroRequest,activationBytes:4}),false,'admission carries no activation');
authority.revoke(grant);assert.equal(await authority.verify(grant,request),false);
time=111;assert.equal(await remote.verify(grant,request),false);
assert.equal(await remote.verify(grant,{identity:binding,canonicalAttempt:current.canonicalAttempt},{settlement:true}),true);
const legacy=createPartitionGrantAuthority({...options,canonicalRuntime:undefined});
assert.equal(await legacy.verify(grant,request),false);
assert.throws(()=>legacy.canonicalScope({identity:binding,limits,disclosure,generationId:hash}),/capability/);
authority.close();remote.close();legacy.close();
console.log('canonical grants: exact attempt/generation/C/L scope, zero-output admission, limits, revocation and settlement passed');
