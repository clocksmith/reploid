// Bind previously observed opening identities before any numerical token execution.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='/var/tmp/reploid-completion-candidate-20261013';
const evidence=new URL('./',import.meta.url);
const load=async path=>JSON.parse(await readFile(path));
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const write=async(path,value)=>{const bytes=JSON.stringify(value,null,2)+'\n';await writeFile(path,bytes);return{path,hash:sha(bytes)};};
const { computeCanonicalSha256 }=await import(root+'/vendor/doppler/0.6.28/src/formats/canonical-hash.js');
const { assertOrderedResidentContract }=await import(root+'/vendor/doppler/0.6.28/src/config/ordered-resident-qualification.js');
const { connectNativeInspector }=await import(root+'/tests/fixtures/native-partition-endpoint.js');
const { validateOrderedCaptureConfiguration }=await import(root+'/tests/fixtures/ordered-partition-reference.js');
const config=await load(root+'/config-preparation.json');
const prior=await load(new URL('../signed-closure-qualification-20261013/fresh-preflight/direction-0-expectations.json',evidence));
const observations=await Promise.all(['load-preflight/mac-input-stage.json','load-preflight/amd-middle-stage.json','load-preflight/suby-output-stage.json'].map(p=>load(new URL('./'+p,evidence))));
const platforms=['mac.lan','x@128.tail995236.ts.net:node-dawn','clocksmith@suby.tail995236.ts.net:node-dawn'];
const endpoints=['http://127.0.0.1:29993',...process.argv.slice(2)];assert.equal(endpoints.length,3);
config.gpuReservation=await load(new URL('./reservation.json',evidence));
const expected={...prior,schema:'doppler.physical-resident-producer-input/v2',logicalStageCount:3,physicalHostCount:3,
 partitionPlan:observations[0].plan,installedFiles:1984,testDeliveryHash:config.delivery.hash,
 requesterId:'repaired-ordered-reference',placementGeneration:1,maxGpuBufferBytes:1420000000,
 deadlines:{stageMs:300000,cleanupMs:10000,observationMs:2000},executables:{},providers:{},surfaces:{},nativeHosts:{},browserVersions:{},placements:[]};
delete expected.preflightBinding;
for(const key of ['archive','manifest','graph','reference'])expected[key+'Hash']=config[key].hash;
expected.factorySha256=observations[0].openingObservation.sources.factory.sha256;
expected.identityHelperSha256=observations[0].openingObservation.sources.identity.sha256;
expected.producerHash=sha(await readFile(new URL('../../../doppler/artifacts/signed-resident-producer-20261012/produce-physical-reports.js',evidence)));
for(let index=0;index<3;index++){
 const executor=config.executors[index],observed=observations[index],id=executor.executorId;
 assert(observed.preparedSuccessfully && !observed.failure && !observed.cleanupFailure);
 assert.equal(observed.delivery.archiveSha256,config.archive.hash.slice(7));
 expected.executables[id]=observed.executableIdentity;expected.providers[id]=observed.prepared.observedProvider;
 expected.surfaces[id]=index===0?'browser-webgpu':'node-webgpu';
 expected.placements.push({partitionIndex:index,platform:platforms[index],executorId:id,participantId:'ordered-stage-'+index,
 transportId:'ordered-transport-'+index,residentId:'ordered-resident-'+index,
 executionId:computeCanonicalSha256(observed.openingObservation.initialExecutionIdentity)});
 let preflight;
 if(index===0){preflight=await load(root+'/mac-preflight.json');assert.equal(preflight.browserVersion,observed.browserVersion);expected.browserVersions[id]=observed.browserVersion;}
 else{
  const cdp=await connectNativeInspector(endpoints[index]);
  try{
   const result=await cdp.send('Runtime.evaluate',{expression:`(()=>{const fs=process.getBuiltinModule('fs'),crypto=process.getBuiltinModule('crypto');const bytes=fs.readFileSync(process.execPath);return {pid:process.pid,node:process.versions.node,fixture:globalThis.__nativePartitionFixture?.identity,executableIdentity:{path:process.execPath,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length}}})()`,returnByValue:true});
   assert(!result.exceptionDetails);const live=result.result.value;assert(live.fixture);assert.deepEqual(live.fixture,observed.nativeIdentity.fixture);assert.equal(live.node,observed.nativeIdentity.node);
   preflight={executorId:id,platform:platforms[index],endpoint:endpoints[index],pid:live.pid,executableIdentity:live.executableIdentity,observedAt:new Date().toISOString()};
  } finally{await cdp.detach();}
  expected.nativeHosts[id]={node:observed.nativeIdentity.node,nativeDeliverySha256:observed.nativeIdentity.fixture.nativeDeliverySha256,testDeliveryHash:config.delivery.hash,provider:observed.nativeProvider};
 }
 assert.deepEqual(preflight.executableIdentity,expected.executables[id]);
 executor.endpoint=endpoints[index];executor.baseUrl='http://127.0.0.1:29850/config/partition-policy.json';
 executor.modelSource='http://127.0.0.1:29851/';
 executor.runtimeBaseUrl=index===0?'http://127.0.0.1:29850/vendor/doppler/0.6.28/src/':observed.nativeIdentity.fixture.runtimeBaseUrl;
 executor.preflight=await write(root+'/'+['mac','amd','suby'][index]+'-preflight.json',preflight);
 await writeFile(new URL('./'+['mac','amd','suby'][index]+'-preflight.json',evidence),JSON.stringify(preflight,null,2)+'\n');
}
expected.orderedContract={schema:'doppler.resident-qualification-contract/v2',manifestIdentity:config.manifest.hash,executionGraphHash:observations[0].openingObservation.initialExecutionIdentity.executionGraphHash,
 partitionPlanHash:observations[0].prepared.planId,partitionPlan:expected.partitionPlan,referenceHash:config.reference.hash,evaluatorHash:expected.evaluatorHash,
 tolerance:0.001,comparedSteps:55,stages:expected.placements.map((x,index)=>({index,surface:expected.surfaces[x.executorId],providerIdentityHash:computeCanonicalSha256(expected.providers[x.executorId])}))};
assertOrderedResidentContract(expected.orderedContract);
config.expectations=await write(root+'/expectations.json',expected);config.launchReady=true;
await mkdir(root+'/output',{recursive:true});
validateOrderedCaptureConfiguration(config,expected);
await write(root+'/config.json',config);
await writeFile(new URL('./expectations.json',evidence),JSON.stringify(expected,null,2)+'\n');
await writeFile(new URL('./config.json',evidence),JSON.stringify(config,null,2)+'\n');
console.log(JSON.stringify({frozen:true,expectationsHash:config.expectations.hash,stages:3,referencePrefixes:55,tolerance:0.001}));
