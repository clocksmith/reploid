// Stage pipeline-preparation measurement for the recurrent-state variant choice: one load-only opening of
// one stage through the real resident opening path (preparePartitionMemory -> Doppler resident opening with
// the placement C policy's limits.maxPreparationMs), no token executed. Copy of observe-identity.js; the
// differences:
//  - stage 0 runs in a persistent Chrome profile (argument 7), so a first opening on a new profile measures
//    cold preparation (no Chrome/Dawn shader cache) and a second opening on the same profile measures warm;
//  - the receipt adds the opening wall time and, for stage 0, the peak resident memory of the profile's
//    Chrome processes sampled every 250 ms (ps RSS sum; GPU process separately).
// Natives are measured by launching them with an empty (cold) or reused (warm) private Mesa cache.
// Usage: node prepare-measure.mjs <root> <output> <stage> <endpoint|-> <policy path> <policy sha256:...> [<profile dir>]
// Load-only observation using the unchanged frozen physical fixture owners.
// Faster candidate placement C: campaign 3's observe-identity.js, code unchanged; it runs against the
// new fixture root (/var/tmp/reploid-faster-candidate-20261015) and the placement C policy.
// Campaign 3 copy of ../completion-candidate-20261013/load-preflight/load-preflight.js: the only change is that
// the partition policy comes from an explicit hash-bound file (prefillTokenChunkSize 16) instead of
// config-preparation's policy. No token executes.
// Usage: node observe-identity.js <root> <output> <stage> <endpoint|-> <policy path> <policy sha256:...>
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [root, output, stageText, endpointArg, policyPath, policyHash, profileDir] = process.argv.slice(2), index = Number(stageText);
const endpoint = endpointArg === '-' ? undefined : endpointArg;
assert(policyPath && /^sha256:[a-f0-9]{64}$/.test(policyHash || ''));
assert(root && output && Number.isInteger(index));
const load = path => import(pathToFileURL(root + '/' + path));
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const { chromium } = await load('node_modules/playwright/index.mjs');
const { physicalWebGpuBrowserOptions } = await load('tests/fixtures/physical-webgpu-browser.js');
const { preparePartitionMemory } = await load('tests/fixtures/prepare-partition-memory.js');
const { observeResidentOpening } = await load('tests/fixtures/resident-opening-observer.js');
const { connectNativePartitionEndpoint } = await load('tests/fixtures/native-partition-endpoint.js');
const { createConcurrentOperationObserver } = await load('tests/fixtures/concurrent-partition-memory.js');
const { assertPartitionMemorySettlement } = await load('tests/fixtures/partition-memory-settlement.js');
const { verifyNumericalTestDelivery } = await load('tests/fixtures/numerical-test-delivery.js');
const { bindPairedPartitionFixture } = await load('tests/fixtures/paired-partition-binding.js');
const config = JSON.parse(await readFile(root + '/config-preparation.json'));
const read = async key => { const bytes = await readFile(config[key].path); assert.equal(sha(bytes), config[key].hash); return bytes; };
const [manifestBytes, graphBytes, archiveBytes, referenceBytes, pairedBytes] = await Promise.all(['manifest','graph','archive','reference','pairedBinding'].map(read));
const policyBytes = await readFile(policyPath); assert.equal(sha(policyBytes), policyHash, 'Policy file changed');
const reference = JSON.parse(referenceBytes), manifest = JSON.parse(manifestBytes);
const pairedBinding = await bindPairedPartitionFixture({ bindingBytes: pairedBytes, graphBytes, modelBytes: manifestBytes, archiveBytes, referenceIdentity: reference.modelIdentity });
const delivery = await verifyNumericalTestDelivery({ root, bindingPath: config.delivery.path, bindingSha256: config.delivery.hash.slice(7), archivePath: config.archive.path, runtimeDirectory: config.runtimeDirectory });
const runtime = await load('vendor/doppler/0.6.28/src/partitions.js');
const plan = runtime.createOrderedLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture, splitLayers: [8,16], activationPrecision: 'two-f32' });
runtime.validateOrderedLayerPartitionPlan(manifest, plan);
const evidence = { schema: 'reploid.ordered-load-only-preflight/v1', index, scope: 'Observed actual opening before numerical expectation freeze; no token execution', startedAt: new Date().toISOString(), delivery, plan, operations: {} };
let writes=Promise.resolve(); const persist=()=>{ const bytes=JSON.stringify(evidence); writes=writes.then(()=>writeFile(output,bytes)); return writes; };
const evaluate=createConcurrentOperationObserver({evidence:evidence.operations,persist});
let browser,context,page,observer;
try {
 if(index===0) {
  assert(profileDir,'Stage 0 needs a persistent profile directory');
  context=await chromium.launchPersistentContext(profileDir,physicalWebGpuBrowserOptions('darwin')); page=context.pages()[0]||await context.newPage();
  browser={close:async()=>{try{await context.close();}catch{}}};
  evidence.profileDir=profileDir;
  const {execFile}=await import('node:child_process');
  // The persistent context exposes no browser target, so the profile's processes are found from ps: the
  // browser process carries --user-data-dir=<profile>, and every helper descends from it.
  const sample=()=>new Promise(resolve=>execFile('ps',['-axo','pid=,ppid=,rss=,command='],{maxBuffer:1<<24},(error,stdout)=>{
   if(error){resolve(null);return;}
   const rows=stdout.split('\n').map(line=>/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(m=>({pid:+m[1],ppid:+m[2],rss:+m[3],command:m[4]}));
   const root=rows.find(row=>row.command.includes('--user-data-dir='+profileDir)&&!row.command.includes('--type='));
   if(!root){resolve(null);return;}
   const tree=new Set([root.pid]);let grew=true;while(grew){grew=false;for(const row of rows)if(!tree.has(row.pid)&&tree.has(row.ppid)){tree.add(row.pid);grew=true;}}
   let total=0,gpu=0;for(const row of rows)if(tree.has(row.pid)){total+=row.rss;if(row.command.includes('--type=gpu-process'))gpu+=row.rss;}
   evidence.pid=root.pid;resolve({totalKiB:total,gpuKiB:gpu});}));
  evidence.memorySamples={peakTotalKiB:0,peakGpuKiB:0,count:0};
  const sampler=setInterval(async()=>{const s=await sample();if(!s)return;const m=evidence.memorySamples;m.count++;m.peakTotalKiB=Math.max(m.peakTotalKiB,s.totalKiB);m.peakGpuKiB=Math.max(m.peakGpuKiB,s.gpuKiB);},250);
  evidence.stopSampler=()=>clearInterval(sampler);
  evidence.browserVersion=await page.evaluate(()=>navigator.userAgent);
  await page.goto('http://127.0.0.1:29850/config/partition-policy.json');
 } else {
  browser=await connectNativePartitionEndpoint(endpoint);context=await browser.newContext();page=await context.newPage();
  evidence.nativeIdentity=browser.identity;evidence.pid=browser.identity.pid;
  evidence.executableIdentity=await page.evaluate(()=>{const fs=process.getBuiltinModule('fs'),crypto=process.getBuiltinModule('crypto');const b=fs.readFileSync(process.execPath);return{path:process.execPath,sha256:crypto.createHash('sha256').update(b).digest('hex'),sizeBytes:b.length};});
  await browser.open();
 }
 evidence.endpoint=endpoint||'owned Chromium launch';await persist(); console.log(JSON.stringify({phase:'preparation',index,pid:evidence.pid}));
 const runtimeBaseUrl=index===0?'http://127.0.0.1:29850/vendor/doppler/0.6.28/src/':browser.identity.fixture.runtimeBaseUrl;
 observer=await observeResidentOpening(page,{runtimeBaseUrl,factorySource:await readFile(config.runtimeDirectory+'/src/client/resident-partitions.js','utf8'),identitySource:await readFile(config.runtimeDirectory+'/src/config/initial-execution-identity.js','utf8')});
 const openingStarted=performance.now();
 evidence.prepared=await evaluate(page,`load-only-stage-${index}`,preparePartitionMemory,{model:{...config.model,generation:reference.generation},index,participantId:`ordered-stage-${index}`,orderedPlan:plan,pairedBinding,modelSource:'http://127.0.0.1:29851/',policy:JSON.parse(policyBytes),config:{DOPPLER_PACKAGE_VERSION:'0.6.28',DOPPLER_PARTITIONS_MODULE_URL:new URL('partitions.js',runtimeBaseUrl).href,DOPPLER_KERNEL_BASE_URL:new URL('gpu/kernels/',runtimeBaseUrl).href}});
 evidence.openingWallMs=performance.now()-openingStarted;
 evidence.pipelinePreparation=evidence.prepared?.descriptor?.pipelinePreparation??null;
 evidence.openingObservation=await observer.finish();
 if(index!==0)evidence.nativeProvider=await page.evaluate(()=>__nativePartitionFixture.observeProvider());
 evidence.observedAt=new Date().toISOString();evidence.preparedSuccessfully=true;await persist();
} catch(error){evidence.failure={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 try{await observer?.close();}catch(error){evidence.observerCloseError=error.message;}
 if(page)try{evidence.settlement=await evaluate(page,`close-load-only-stage-${index}`,async()=>{await globalThis.resident?.close();return globalThis.settleMemory?.();},undefined,true);if(evidence.settlement)assertPartitionMemorySettlement(evidence.settlement);}catch(error){evidence.cleanupFailure=error.message;evidence.ownership='unknown';process.exitCode=1;}
 try{if(context)await evaluate({evaluate:()=>context.close()},'close-context',()=>{},undefined,true,false);}catch(error){evidence.contextError=error.message;process.exitCode=1;}
 try{if(browser)evidence.providerSettlement=await evaluate({evaluate:()=>browser.close()},'close-provider',()=>{},undefined,true,false);}catch(error){evidence.providerError=error.message;process.exitCode=1;}
 evidence.stopSampler?.();delete evidence.stopSampler;
 evidence.finishedAt=new Date().toISOString();await persist();console.log(JSON.stringify({index,prepared:evidence.preparedSuccessfully,failure:evidence.failure,cleanupFailure:evidence.cleanupFailure,providerError:evidence.providerError}));
}
