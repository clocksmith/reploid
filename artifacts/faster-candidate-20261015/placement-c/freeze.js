// Bind freshly observed opening identities before any numerical token execution.
// Faster candidate, placement C: campaign 3's freeze.js (../../completion-qualification-3-20261014/freeze.js)
// with these changes.
// 1. Candidate: fixture root /var/tmp/reploid-faster-candidate-20261015 (runtime archive 21d054ee...,
//    Doppler 1c9ec3db; combined kernel manifest 64d74719...). Its runtime validators and identity
//    helpers are the ones imported below.
// 2. Placement C: mac-host browser stage 0 (layers 0-7), amd-host native stage 1 (layers 8-15) and a
//    second amd-host native stage 2 (layers 16-23 and the output head). Three logical stages on two
//    physical hosts (physicalHostCount 2); the two natives have distinct owned inspector endpoints,
//    processes and scopes.
// 3. Expected identities: fresh load-only observations of all three stages under this candidate and
//    the placement C policy (../observation/*.json, observe-identity.js; no token executed), because
//    the retained campaign 1 observations bind the old runtime's factory, delivery and identity.
//    The three stages must observe one identical initial execution identity; it must rebuild exactly
//    through createInitialExecutionIdentityV2, declare prefillTokenChunkSize 16 and prefillChunkLayers 1,
//    and keep campaign 3's dtype lane, KV layout, memory policy and fusion set. The leaves that differ
//    from campaign 3's chunk-16 identity are recorded.
// 4. Policy: the fixture policy with prefillTokenChunkSize 16 and limits.maxPreparationMs 1200000
//    (make-policy.py); the candidate refuses an opening without a declared preparation bound.
// Usage: node freeze.js <attempt dir: c|c2|...> <amd stage-1 inspector ws> <amd stage-2 inspector ws>
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Attempt c binds generation 1 (manifest 64d74719...); c2 and later bind generation 2 (manifest c6220c6a...,
// fixture root -2, observations in ../observation-2/).
const [placementName,amd1Endpoint,amd2Endpoint]=process.argv.slice(2);
// Attempts c4 to c8 bind generation 3 (the chosen rolled state variant: archive 3b132ee7..., manifest 548e6559...,
// fixture root -3, observations in ../observation-3/).
const generation=placementName==='c'?1:['c4','c5','c6','c7','c8'].includes(placementName)?3:2;
const root='/var/tmp/reploid-faster-candidate-20261015'+({1:'',2:'-2',3:'-3'})[generation];
assert(/^c[0-9]*$/.test(placementName||'')&&amd1Endpoint&&amd2Endpoint&&amd1Endpoint!==amd2Endpoint,'Usage: node freeze.js <c|c2|...> <amd stage-1 ws> <amd stage-2 ws>');
const campaign='/var/tmp/faster-candidate-20261015-mac/placement-c/'+placementName;
const evidence=new URL('./'+placementName+'/',import.meta.url);
const CHUNK=16, PREPARATION_MS=1200000;
const load=async path=>JSON.parse(await readFile(path));
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const write=async(path,value)=>{const bytes=JSON.stringify(value,null,2)+'\n';await writeFile(path,bytes,{flag:'wx'});return{path,hash:sha(bytes)};};
const { computeCanonicalSha256 }=await import(root+'/vendor/doppler/0.6.28/src/formats/canonical-hash.js');
const { createInitialExecutionIdentityV2, validateInitialExecutionIdentity }=await import(root+'/vendor/doppler/0.6.28/src/config/initial-execution-identity.js');
const { assertOrderedResidentContract }=await import(root+'/vendor/doppler/0.6.28/src/config/ordered-resident-qualification.js');
const { connectNativeInspector }=await import(root+'/tests/fixtures/native-partition-endpoint.js');
const { validateOrderedCaptureConfiguration }=await import(root+'/tests/fixtures/ordered-partition-reference.js');
const config=await load(root+'/config-preparation.json');
const prior=await load(new URL('../../../signed-closure-qualification-20261013/fresh-preflight/direction-0-expectations.json',evidence));
const loadObservation=name=>load(new URL(({1:'../observation/',2:'../observation-2/',3:'../observation-3/'})[generation]+name,evidence));
const machines={
 mac:{observation:await loadObservation('mac-stage-0.json'),index:0,platform:'mac.lan',executor:config.executors[0],preflight:'mac'},
 amd1:{observation:await loadObservation('amd-stage-1.json'),index:1,platform:'amd-host:node-dawn',executor:config.executors[1],endpoint:amd1Endpoint,preflight:'amd-1'},
 amd2:{observation:await loadObservation('amd-stage-2.json'),index:2,platform:'amd-host:node-dawn',executor:config.executors[2],endpoint:amd2Endpoint,preflight:'amd-2'},
};
const order=['mac','amd1','amd2'];
const executorName={mac:'mac',amd1:'amd',amd2:'amd'};

// Policy: the placement C policy, checked against its derivation from the frozen fixture policy.
const fixturePolicyBytes=await readFile(config.policy.path);
assert.equal(sha(fixturePolicyBytes),'sha256:5a6f974f34b1cba00aff269857c3fe53728782317477bede684a0e11f2b6a235','Fixture policy changed');
const derived=JSON.parse(fixturePolicyBytes);derived.prefillTokenChunkSize=CHUNK;derived.limits.maxPreparationMs=PREPARATION_MS;
const policyBytes=await readFile('/var/tmp/faster-candidate-20261015-mac/placement-c/partition-policy.json');
const policy=JSON.parse(policyBytes);
assert.deepEqual(policy,derived,'Placement C policy differs from its derivation');
await mkdir(campaign,{recursive:true});await mkdir(new URL('./',evidence),{recursive:true});
config.policy=await write(campaign+'/partition-policy.json',policy);
await writeFile(new URL('./partition-policy.json',evidence),JSON.stringify(policy,null,2)+'\n',{flag:'wx'});

// Expected identity: the fresh load-only observations, one identity for all three stages.
for(const name of order){const o=machines[name].observation;
 assert(o.preparedSuccessfully&&!o.failure&&!o.cleanupFailure&&o.settlement,`Load-only observation of ${name} incomplete`);
 assert.equal(o.index,machines[name].index);assert.equal(o.delivery.archiveSha256,config.archive.hash.slice(7));}
const observedIdentities=order.map(name=>machines[name].observation.openingObservation.initialExecutionIdentity);
for(const identity of observedIdentities)assert.equal(computeCanonicalSha256(identity),computeCanonicalSha256(observedIdentities[0]),'Stage identities differ');
const identity=observedIdentities[0];
assert(validateInitialExecutionIdentity(identity).ok);
assert.deepEqual(createInitialExecutionIdentityV2((({schema,kernelClosureHash,fusionSetHash,kvLayoutHash,memoryPolicyHash,runtimeEngineDigest,programLoadPolicyHash,digest,...fields})=>fields)(identity)),identity);
assert.equal(identity.programLoadPolicy.runtimeConfig.inference.session.prefillTokenChunkSize,CHUNK);
assert.equal(identity.programLoadPolicy.runtimeConfig.inference.session.prefillChunkLayers,1);
const campaign3=(await load(new URL('../../../completion-qualification-3-20261014/b/chunked-identity.json',evidence))).identity;
for(const key of ['dtypeLane','kvLayout','memoryPolicy','fusionSet'])assert.deepEqual(identity[key],campaign3[key],`${key} changed from campaign 3`);
const leaves=(value,path=[],out={})=>{if(value&&typeof value==='object'){for(const [key,child] of Object.entries(value))leaves(child,[...path,key],out);}else out[path.join('.')]=value;return out;};
const before=leaves(campaign3),after=leaves(identity);
const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>before[key]!==after[key]).sort();
const executionId=computeCanonicalSha256(identity);

config.gpuReservation=await load(new URL('./reservation.json',evidence));
const expected={...prior,schema:'doppler.physical-resident-producer-input/v2',logicalStageCount:3,physicalHostCount:2,
 partitionPlan:machines.mac.observation.plan,installedFiles:generation===3?1999:1998,testDeliveryHash:config.delivery.hash,
 requesterId:'repaired-ordered-reference',placementGeneration:1,maxGpuBufferBytes:1420000000,
 deadlines:{stageMs:300000,cleanupMs:10000,observationMs:2000},executables:{},providers:{},surfaces:{},nativeHosts:{},browserVersions:{},placements:[]};
delete expected.preflightBinding;
for(const key of ['archive','manifest','graph','reference'])expected[key+'Hash']=config[key].hash;
for(const name of order){assert.deepEqual(machines[name].observation.plan,expected.partitionPlan,'Stage plans differ');
 assert.equal(machines[name].observation.openingObservation.sources.factory.sha256,machines.mac.observation.openingObservation.sources.factory.sha256);}
expected.factorySha256=machines.mac.observation.openingObservation.sources.factory.sha256;
expected.identityHelperSha256=machines.mac.observation.openingObservation.sources.identity.sha256;
expected.producerHash=sha(await readFile(new URL('../../../../../doppler/artifacts/signed-resident-producer-20261012/produce-physical-reports.js',evidence)));
const executors=[];
for(let index=0;index<3;index++){
 const name=order[index],machine=machines[name],observed=machine.observation;
 const executor={...structuredClone(machine.executor),executorId:executorName[name]+'-stage-'+index};
 const id=executor.executorId;
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
   assert.notEqual(live.pid,observed.pid,'Capture natives must be fresh processes, not the observed ones');
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
expected.orderedContract={schema:'doppler.resident-qualification-contract/v2',manifestIdentity:config.manifest.hash,executionGraphHash:identity.executionGraphHash,
 partitionPlanHash:machines.mac.observation.prepared.planId,partitionPlan:expected.partitionPlan,referenceHash:config.reference.hash,evaluatorHash:expected.evaluatorHash,
 tolerance:0.001,comparedSteps:55,stages:expected.placements.map((x,index)=>({index,surface:expected.surfaces[x.executorId],providerIdentityHash:computeCanonicalSha256(expected.providers[x.executorId])}))};
assertOrderedResidentContract(expected.orderedContract);
config.expectations=await write(campaign+'/expectations.json',expected);config.launchReady=true;config.outputPath=campaign+'/output/reference.json';
await mkdir(campaign+'/output',{recursive:true});
validateOrderedCaptureConfiguration(config,expected);
await write(campaign+'/config.json',config);
await writeFile(new URL('./expectations.json',evidence),JSON.stringify(expected,null,2)+'\n',{flag:'wx'});
await writeFile(new URL('./config.json',evidence),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
await writeFile(new URL('./candidate-identity.json',evidence),JSON.stringify({campaign3ChunkedExecutionId:computeCanonicalSha256(campaign3),
 executionId,source:'observation/*-stage-*.json (load-only, no token executed), identical on all three stages',
 changedLeavesFromCampaign3:changed.map(key=>({path:key,campaign3:before[key]??null,candidate:after[key]??null})),identity},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({frozen:true,placement:placementName,order,expectationsHash:config.expectations.hash,executionId,stages:3,physicalHosts:2,referencePrefixes:55,tolerance:0.001,changedLeaves:changed.length}));
