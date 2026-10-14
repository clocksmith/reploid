// Bind previously observed opening identities before any numerical token execution.
// Third campaign: campaign 2's freeze (../completion-qualification-2-20261013/freeze.js) with two changes.
// 1. Prefill is chunked at 16 tokens. The partition policy gets a new hash-bound copy. The expected
//    initial execution identity is a fresh load-only observation under that policy
//    (identity-observation/mac-stage-0.json, observe-identity.js; no token executed). It may differ from
//    the retained chunk-256 observation only in the chunk size, the resolved runtime session id and the
//    hashes derived from them. Attempt a1 froze a hand-rebuilt identity, which missed the session id;
//    the live harness refused it before any token ran.
// 2. The placement is an argument: A = mac, amd, intel (output head on Intel); B = mac, intel, amd
//    (output head on AMD). Machine-specific identities follow the machine, not the partition index.
// Usage: node freeze.js <attempt dir: a|a2|b|...> <amd inspector ws> <intel inspector ws>
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='/var/tmp/reploid-completion-candidate-20261013';
const [placementName,amdEndpoint,intelEndpoint]=process.argv.slice(2);
assert(/^[ab][0-9]*$/.test(placementName||'')&&amdEndpoint&&intelEndpoint,'Usage: node freeze.js <a|a2|b|...> <amd ws> <intel ws>');
const campaign='/var/tmp/reploid-completion-qualification-3-20261014/'+placementName;
const evidence=new URL('./'+placementName+'/',import.meta.url);
const CHUNK=16;
const load=async path=>JSON.parse(await readFile(path));
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const write=async(path,value)=>{const bytes=JSON.stringify(value,null,2)+'\n';await writeFile(path,bytes,{flag:'wx'});return{path,hash:sha(bytes)};};
const { computeCanonicalSha256 }=await import(root+'/vendor/doppler/0.6.28/src/formats/canonical-hash.js');
const { createInitialExecutionIdentityV2, validateInitialExecutionIdentity }=await import(root+'/vendor/doppler/0.6.28/src/config/initial-execution-identity.js');
const { assertOrderedResidentContract }=await import(root+'/vendor/doppler/0.6.28/src/config/ordered-resident-qualification.js');
const { connectNativeInspector }=await import(root+'/tests/fixtures/native-partition-endpoint.js');
const { validateOrderedCaptureConfiguration }=await import(root+'/tests/fixtures/ordered-partition-reference.js');
const config=await load(root+'/config-preparation.json');
const prior=await load(new URL('../../signed-closure-qualification-20261013/fresh-preflight/direction-0-expectations.json',evidence));
const loadObservation=name=>load(new URL('../../completion-candidate-20261013/load-preflight/'+name,evidence));
const machines={
 mac:{observation:await loadObservation('mac-input-stage.json'),platform:'mac.lan',executor:config.executors[0],preflight:'mac'},
 amd:{observation:await loadObservation('amd-middle-stage.json'),platform:'amd-host:node-dawn',executor:config.executors[1],endpoint:amdEndpoint,preflight:'amd'},
 intel:{observation:await loadObservation('suby-output-stage.json'),platform:'intel-host:node-dawn',executor:config.executors[2],endpoint:intelEndpoint,preflight:'suby'},
};
const order=placementName[0]==='a'?['mac','amd','intel']:['mac','intel','amd'];
const executorName={mac:'mac',amd:'amd',intel:'suby'};

// Policy: the frozen fixture policy with only the prefill token chunk changed.
const policyBytes=await readFile(config.policy.path);
assert.equal(sha(policyBytes),'sha256:5a6f974f34b1cba00aff269857c3fe53728782317477bede684a0e11f2b6a235','Fixture policy changed');
const policy=JSON.parse(policyBytes);
assert.equal(policy.prefillTokenChunkSize,256);assert.equal(policy.prefillChunkLayers,1);
policy.prefillTokenChunkSize=CHUNK;
await mkdir(campaign,{recursive:true});await mkdir(new URL('./',evidence),{recursive:true});
config.policy=await write(campaign+'/partition-policy.json',policy);
await writeFile(new URL('./partition-policy.json',evidence),JSON.stringify(policy,null,2)+'\n',{flag:'wx'});

// Expected identity: the fresh chunk-16 load-only observation, checked field by field against the
// retained chunk-256 observation.
const observedIdentities=order.map(name=>machines[name].observation.openingObservation.initialExecutionIdentity);
for(const identity of observedIdentities)assert.equal(computeCanonicalSha256(identity),computeCanonicalSha256(observedIdentities[0]),'Stage identities differ');
const original=observedIdentities[0];
const fresh=await load(new URL('../identity-observation/mac-stage-0.json',evidence));
assert(fresh.preparedSuccessfully&&!fresh.failure&&!fresh.cleanupFailure&&fresh.settlement,'Fresh identity observation incomplete');
const chunked=fresh.openingObservation.initialExecutionIdentity;
assert(validateInitialExecutionIdentity(chunked).ok);
assert.deepEqual(createInitialExecutionIdentityV2((({schema,kernelClosureHash,fusionSetHash,kvLayoutHash,memoryPolicyHash,runtimeEngineDigest,programLoadPolicyHash,digest,...fields})=>fields)(chunked)),chunked);
const leaves=(value,path=[],out={})=>{if(value&&typeof value==='object'){for(const [key,child] of Object.entries(value))leaves(child,[...path,key],out);}else out[path.join('.')]=value;return out;};
const before=leaves(original),after=leaves(chunked);
const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>before[key]!==after[key]).sort();
assert.deepEqual(changed,['digest','programLoadPolicy.runtimeConfig.inference.session.prefillTokenChunkSize','programLoadPolicyHash',
 'runtimeEngine.resolvedRuntimeSessionId','runtimeEngineDigest'],'Chunked identity differs beyond the chunk and its session id');
assert.equal(after['programLoadPolicy.runtimeConfig.inference.session.prefillTokenChunkSize'],CHUNK);
assert.equal(after['programLoadPolicy.runtimeConfig.inference.session.prefillChunkLayers'],1);
const executionId=computeCanonicalSha256(chunked);

config.gpuReservation=await load(new URL('./reservation.json',evidence));
const platforms=order.map(name=>machines[name].platform);
const expected={...prior,schema:'doppler.physical-resident-producer-input/v2',logicalStageCount:3,physicalHostCount:3,
 partitionPlan:machines.mac.observation.plan,installedFiles:1984,testDeliveryHash:config.delivery.hash,
 requesterId:'repaired-ordered-reference',placementGeneration:1,maxGpuBufferBytes:1420000000,
 deadlines:{stageMs:300000,cleanupMs:10000,observationMs:2000},executables:{},providers:{},surfaces:{},nativeHosts:{},browserVersions:{},placements:[]};
delete expected.preflightBinding;
for(const key of ['archive','manifest','graph','reference'])expected[key+'Hash']=config[key].hash;
expected.factorySha256=machines.mac.observation.openingObservation.sources.factory.sha256;
expected.identityHelperSha256=machines.mac.observation.openingObservation.sources.identity.sha256;
expected.producerHash=sha(await readFile(new URL('../../../../doppler/artifacts/signed-resident-producer-20261012/produce-physical-reports.js',evidence)));
const executors=[];
for(let index=0;index<3;index++){
 const name=order[index],machine=machines[name],observed=machine.observation;
 const executor={...structuredClone(machine.executor),executorId:executorName[name]+'-stage-'+index};
 const id=executor.executorId;
 assert(observed.preparedSuccessfully && !observed.failure && !observed.cleanupFailure);
 assert.equal(observed.delivery.archiveSha256,config.archive.hash.slice(7));
 expected.executables[id]=observed.executableIdentity;expected.providers[id]=observed.prepared.observedProvider;
 expected.surfaces[id]=name==='mac'?'browser-webgpu':'node-webgpu';
 expected.placements.push({partitionIndex:index,platform:machine.platform,executorId:id,participantId:'ordered-stage-'+index,
 transportId:'ordered-transport-'+index,residentId:'ordered-resident-'+index,executionId});
 let preflight;
 if(name==='mac'){
  preflight={...await load(campaign+'/mac-preflight.json')};assert.equal(preflight.browserVersion,observed.browserVersion);
  assert.equal(preflight.executorId,'mac-stage-0');expected.browserVersions[id]=observed.browserVersion;
  executor.endpoint=preflight.endpoint;
 } else {
  const cdp=await connectNativeInspector(machine.endpoint);
  try{
   const result=await cdp.send('Runtime.evaluate',{expression:`(()=>{const fs=process.getBuiltinModule('fs'),crypto=process.getBuiltinModule('crypto');const bytes=fs.readFileSync(process.execPath);return {pid:process.pid,node:process.versions.node,fixture:globalThis.__nativePartitionFixture?.identity,executableIdentity:{path:process.execPath,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length}}})()`,returnByValue:true});
   assert(!result.exceptionDetails);const live=result.result.value;assert(live.fixture);assert.deepEqual(live.fixture,observed.nativeIdentity.fixture);assert.equal(live.node,observed.nativeIdentity.node);
   preflight={executorId:id,platform:machine.platform,endpoint:machine.endpoint,pid:live.pid,executableIdentity:live.executableIdentity,observedAt:new Date().toISOString()};
  } finally{await cdp.detach();}
  expected.nativeHosts[id]={node:observed.nativeIdentity.node,nativeDeliverySha256:observed.nativeIdentity.fixture.nativeDeliverySha256,testDeliveryHash:config.delivery.hash,provider:observed.nativeProvider};
  executor.endpoint=machine.endpoint;
 }
 assert.deepEqual(preflight.executableIdentity,expected.executables[id]);
 executor.baseUrl='http://127.0.0.1:29850/config/partition-policy.json';
 executor.modelSource='http://127.0.0.1:29851/';
 executor.runtimeBaseUrl=name==='mac'?'http://127.0.0.1:29850/vendor/doppler/0.6.28/src/':observed.nativeIdentity.fixture.runtimeBaseUrl;
 if(name==='mac'){const bytes=await readFile(campaign+'/mac-preflight.json');executor.preflight={path:campaign+'/mac-preflight.json',hash:sha(bytes)};}
 else executor.preflight=await write(campaign+'/'+machine.preflight+'-preflight.json',preflight);
 await writeFile(new URL('./'+machine.preflight+'-preflight.json',evidence),JSON.stringify(preflight,null,2)+'\n',{flag:'wx'});
 executors.push(executor);
}
config.executors=executors;
expected.orderedContract={schema:'doppler.resident-qualification-contract/v2',manifestIdentity:config.manifest.hash,executionGraphHash:chunked.executionGraphHash,
 partitionPlanHash:machines.mac.observation.prepared.planId,partitionPlan:expected.partitionPlan,referenceHash:config.reference.hash,evaluatorHash:expected.evaluatorHash,
 tolerance:0.001,comparedSteps:55,stages:expected.placements.map((x,index)=>({index,surface:expected.surfaces[x.executorId],providerIdentityHash:computeCanonicalSha256(expected.providers[x.executorId])}))};
assertOrderedResidentContract(expected.orderedContract);
config.expectations=await write(campaign+'/expectations.json',expected);config.launchReady=true;config.outputPath=campaign+'/output/reference.json';
await mkdir(campaign+'/output',{recursive:true});
validateOrderedCaptureConfiguration(config,expected);
await write(campaign+'/config.json',config);
await writeFile(new URL('./expectations.json',evidence),JSON.stringify(expected,null,2)+'\n',{flag:'wx'});
await writeFile(new URL('./config.json',evidence),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
await writeFile(new URL('./chunked-identity.json',evidence),JSON.stringify({chunk256ExecutionId:computeCanonicalSha256(original),
 chunk16ExecutionId:executionId,source:'identity-observation/mac-stage-0.json (load-only, no token executed)',
 changedLeaves:changed.map(key=>({path:key,chunk256:before[key],chunk16:after[key]})),identity:chunked},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({frozen:true,placement:placementName,order,expectationsHash:config.expectations.hash,executionId,stages:3,referencePrefixes:55,tolerance:0.001}));
