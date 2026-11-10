// Explicit native GPU/WebRTC/credit check against an installed delivery. Operator paths stay outside the repository.
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {createInterface} from 'node:readline';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';import {randomUUID,randomBytes} from 'node:crypto';
if (process.env.REPLOID_FLEET_PHYSICAL !== '1') throw Error('Explicit physical opt-in required');
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const root=config.stateDirectory, pkg=JSON.parse(await fs.readFile(config.packageReceipt,'utf8'));
if (!['whole-model','partition'].includes(config.mode) || !path.isAbsolute(root)) throw Error('Explicit mode and absolute state directory required');
await fs.mkdir(root,{recursive:true,mode:0o700});
const reportFile=path.join(root,config.mode+'-physical.json');
const from=async f=>import(pathToFileURL(pkg.directory+'/'+f));
const {openFleetNativeHost,openComputerIdentity}=await from('server/fleet/native-host.js');
const {openFleetCredits}=await from('server/fleet/credits.js');const {startFleetService,createFleetClient}=await from('server/fleet/service.js');
const remoteRoot=config.remote.releaseRoot;
const ssh=code=>['-o','BatchMode=yes',config.remote.ssh,'node','-e',`"eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())"`];
async function remoteWrite(files){const child=spawn('ssh',ssh(`const fs=require('fs');let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{for(const [p,v] of JSON.parse(s)){fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,v,{mode:384})}});`),{stdio:['pipe','ignore','inherit']});child.stdin.end(JSON.stringify(files));await new Promise((r,j)=>child.on('exit',c=>c===0?r():j(Error('remote write '+c))));}
const token=randomBytes(32).toString('hex'), room='reploid-swarm-fleet-agent-f-'+randomUUID();await fs.writeFile(root+'/room.token',token,{mode:0o600});
const model=structuredClone(config.model);
if(config.mode==='partition'){
  const require=createRequire(path.join(pkg.directory,'package.json'));
  const partitions=await import(pathToFileURL(require.resolve('doppler-gpu/partitions')));
  model.partitionPlan=partitions.createOrderedLayerPartitionPlanFromManifest(JSON.parse(await fs.readFile(config.local.modelDirectory+'/manifest.json')),config.partition);
  model.partitionPlanId=partitions.hashLayerPartitionPlan(model.partitionPlan);
  model.partitionRuntime={maxGpuBufferBytes:config.stageGpuBudgets,runtimeConfig:structuredClone(model.loadOptions.runtimeConfig)};
  delete model.partitionSplitLayer;
}
const ordered=index=>({stage:{modelId:model.id,index,residentId:'fleet-resident-'+index+'-'+randomUUID(),executionId:'fleet-execution-'+index+'-'+randomUUID()},maxStages:2,maxStageOffersPerPeer:2,maxRouteBytes:8192,maxSelectionSteps:2000,maxRoutes:2});
const common={schema:'reploid.fleet-native/v1',roomId:room,signalingUrl:config.signalingUrl,origin:'http://localhost:8000',maxOutputTokens:model.generation.maxTokens};
const remoteConfig={...common,serviceUrl:config.coordinator.url,computerId:config.remote.computerId,name:config.remote.name,identityFile:remoteRoot+'/state/identity.json',roomTokenFile:remoteRoot+'/room.token',ownerPolicyFile:config.remote.ownerPolicyFile,observationFile:remoteRoot+'/observation.json',models:[{model,mode:config.mode,ordered:config.mode==='partition'?ordered(1):null,directory:config.remote.modelDirectory}]};
await remoteWrite([[remoteRoot+'/host.json',JSON.stringify(remoteConfig)],[remoteRoot+'/room.token',token],[remoteRoot+'/tls/cert.pem',await fs.readFile(config.coordinator.certFile,'utf8')]]);
const integrity="const fs=require('fs');if(require('crypto').createHash('sha256').update(fs.readFileSync("+JSON.stringify(remoteRoot+'/reploid/native-delivery.json')+")).digest('hex')!=="+JSON.stringify(pkg.manifestSha256)+")throw Error('Remote package identity differs');";
const launch=integrity+"const p=require('child_process').spawn("+JSON.stringify(config.remote.node)+",["+JSON.stringify(remoteRoot+'/reploid/server/fleet/native-host.js')+","+JSON.stringify(remoteRoot+'/host.json')+"],{stdio:'inherit',env:{...process.env,NODE_EXTRA_CA_CERTS:"+JSON.stringify(remoteRoot+'/tls/cert.pem')+"}});p.on('exit',c=>process.exit(c??1));";
const remote=spawn('ssh',ssh(launch),{stdio:['pipe','pipe','pipe']});
const stderr=await fs.open(root+'/'+config.mode+'-remote.log','w');remote.stderr.on('data',b=>stderr.write(b));
const pending=new Map();let readyResolve,readyReject;const ready=new Promise((r,j)=>{readyResolve=r;readyReject=j});const rl=createInterface({input:remote.stdout});
rl.on('line',line=>{let v;try{v=JSON.parse(line)}catch{return}if(v.ready)readyResolve(v);if(v.id&&pending.has(v.id)&&!('delta'in v)){const p=pending.get(v.id);pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(v.error)):p.resolve(v.result)}});
remote.on('exit',c=>{readyReject(Error('remote exited '+c));for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('remote exited '+c))}pending.clear()});
const command=(op,body={})=>new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(Error('remote '+op+' timed out'))},600000);pending.set(id,{resolve,reject,timer});remote.stdin.write(JSON.stringify({id,op,...body})+'\n')});
let local,credits,service;const report={schema:'reploid.fleet-physical/v1',at:new Date().toISOString(),mode:config.mode,package:pkg,passed:false,rows:[]};
const save=()=>fs.writeFile(reportFile,JSON.stringify(report,null,2));
const log=(phase,value={})=>{console.log(JSON.stringify({phase,...value}));};
try{
 const remoteIdentity=await Promise.race([ready,new Promise((_,j)=>setTimeout(()=>j(Error('remote startup timed out')),45000).unref())]);log('remote-ready',{participantId:remoteIdentity.participantId});
 const identity=await openComputerIdentity(root+'/state/identity.json');
 const computers=[{id:config.local.computerId,name:config.local.name,ownerId:'owner',providers:[{participantId:identity.peerId,publicJwk:identity.publicJwk}]},{id:config.remote.computerId,name:config.remote.name,ownerId:'owner',providers:[{participantId:remoteIdentity.participantId,publicJwk:remoteIdentity.publicJwk}]}];
 credits=await openFleetCredits({file:root+'/physical-credits-'+randomUUID()+'.sqlite',computers,policy:{schema:'reploid.service-credit-policy/v1',version:'fleet-physical/1',unit:'noncash-service-credit',creditsPerOutputToken:1,maxDebt:10000,maxOutputTokens:model.generation.maxTokens,maxPendingPerComputer:8,maxClockSkewMs:30000,maxRequestMs:300000,allowSameOwner:true}});
 service=await startFleetService({credits,port:config.coordinator.port,listenHost:config.coordinator.listenHost,tls:{key:await fs.readFile(config.coordinator.keyFile),cert:await fs.readFile(config.coordinator.certFile)},models:[{...model,...(config.mode==='partition'?{plans:[{id:model.partitionPlanId,creditWeights:[1,1],stageCount:2,activationBytesPerToken:model.partitionPlan.hiddenSize*4}]}:{})}],placementPolicy:{maxMeasurementAgeMs:86400000,maxObservationAgeMs:60000,minResidencyMs:60000,maxRouteCandidates:100,queuedRequestsPerReplica:2}});
 local=await openFleetNativeHost({configuration:{...common,computerId:config.local.computerId,name:config.local.name,identityFile:root+'/state/identity.json',roomTokenFile:root+'/room.token',serviceUrl:service.url,models:[{model,mode:'partition',ordered:config.mode==='partition'?ordered(0):null,directory:config.local.modelDirectory}]},onChange:()=>{}});
 await local.select(0,config.mode==='partition');log('local-stage-ready');
 const loadStart=performance.now();await command('select',{index:0,contribute:true});report.remoteLoadMs=performance.now()-loadStart;log('provider-loaded',{ms:report.remoteLoadMs});
 const start=Date.now();let selected;
 while(Date.now()-start<90000){selected=local.state().execution?.models?.find(m=>m.id===model.id&&m.identity===model.identity&&m.availability==='ready'&&(config.mode==='partition'?!!m.partition:!m.partition));if(selected)break;const ls=local.state().execution;if(ls?.phase==='failed')throw Error('Local stage: '+ls.error);const rs=await command('state');if(rs.execution?.phase==='failed')throw Error('Remote stage: '+rs.execution.error);await new Promise(r=>setTimeout(r,1000));}
 if(!selected){report.discovery=local.state();report.remote=await command('state');throw Error('No exact ready provider discovered')}
 for(const prompt of config.prompts){
  const request={threadId:randomUUID(),attemptId:randomUUID(),model:selected,messages:[{role:'user',content:prompt}]};const start=performance.now(),deltas=[];
  const result=await local.generate(request,d=>deltas.push(d));report.rows.push({prompt,wallMs:performance.now()-start,deltas,result});log('answer',{content:result.content,usage:result.usage,credit:result.serviceCredit});await save();
  if(result.serviceCredit?.status==='pending')throw Error(result.serviceCredit.error);
 }
 report.local=local.state();report.remote=await command('state');
 const gpuLimit=report.remote.hardware.gpuBuffers?.maxBytes;
 if(!Number.isSafeInteger(gpuLimit)||gpuLimit>config.stageGpuBudgets[1])throw Error('Provider did not enforce its declared device allocation ceiling');
 if(config.exercisePlacement){
  if(config.mode!=='whole-model')throw Error('Placement load check requires whole-model measurement');
  const h=report.remote.hardware, rows=report.rows, at=Date.now();
  const observation={id:config.remote.computerId,participantId:remoteIdentity.participantId,softwareIdentity:'sha256:'+pkg.manifestSha256,
   observedAt:at,activeRequests:0,resident:null,freeGpuBytes:config.stageGpuBudgets[1],freeHostBytes:h.freeHostBytes,
   maxStorageBufferBindingSize:h.maxStorageBufferBindingSize,
   preferences:{enabled:true,models:[{id:model.id,identity:model.identity}],maxGpuBytes:config.stageGpuBudgets[1],maxHostBytes:config.stageGpuBudgets[1]},
   measurements:[{modelIdentity:model.identity,mode:'whole-model',softwareIdentity:'sha256:'+pkg.manifestSha256,qualified:true,
    receipt:reportFile,observedAt:at,maxPromptTokens:Math.max(...rows.map(r=>r.result.usage.inputTokens)),maxOutputTokens:Math.max(...rows.map(r=>r.result.usage.outputTokens)),
    prefillTokensPerSecond:Math.min(...rows.map(r=>1000*r.result.usage.inputTokens/r.result.execution.timing.prefillMs)),
    decodeTokensPerSecond:Math.min(...rows.map(r=>1000*(r.result.usage.outputTokens-1)/r.result.execution.timing.decodeMs)),
    loadMs:Math.ceil(report.remoteLoadMs),requiredGpuBytes:h.gpuBuffers.peakBytes,requiredHostBytes:h.processResidentBytes,
    largestBindingBytes:h.maxStorageBufferBindingSize}]};
  await remoteWrite([[remoteRoot+'/observation.json',JSON.stringify(observation)]]);
  await command('select',{index:0,contribute:false});
  const scheduler=createFleetClient({url:service.url,identity});
  const row=rows[0];
  await scheduler.call('demand',{id:config.local.computerId,requests:[{id:model.id,identity:model.identity,queued:1,since:Date.now(),promptTokens:row.result.usage.inputTokens,outputTokens:row.result.usage.outputTokens}]});
  const plan=await command('reconcile');report.placement={observation,plan};
  if(!plan.decisions.some(d=>d.computerId===config.remote.computerId&&d.action==='prepare'))throw Error('Demand did not prepare the measured provider');
  let modelReady; const deadline=Date.now()+90000;
  while(Date.now()<deadline){modelReady=local.state().execution.models.find(m=>m.id===model.id&&m.availability==='ready'&&!m.partition);if(modelReady)break;await new Promise(r=>setTimeout(r,1000));}
  if(!modelReady)throw Error('Automatically prepared provider was not discovered');
  report.placement.answer=await local.generate({threadId:randomUUID(),attemptId:randomUUID(),model:modelReady,messages:[{role:'user',content:row.prompt}]});
  if(report.placement.answer.content!==row.result.content||report.placement.answer.serviceCredit.status==='pending')throw Error('Automatic placement answer or settlement differs');
  observation.preferences.enabled=false;
  await remoteWrite([[remoteRoot+'/observation.json',JSON.stringify(observation)]]);
  report.placement.optOut=await command('reconcile');report.placement.afterOptOut=await command('state');
  if(!report.placement.optOut.decisions.some(d=>d.computerId===config.remote.computerId&&d.action==='stop')||report.placement.afterOptOut.execution.phase==='ready')throw Error('Owner opt-out did not stop idle contribution');
  await scheduler.call('demand',{id:config.local.computerId,requests:[]});
  log('automatic-placement-passed');
 }
 report.balances=credits.snapshot();report.passed=true;
}catch(error){report.failure=error.stack;process.exitCode=1;log('failed',{error:String(error)});}
finally{await save();await local?.close().catch(e=>{report.localCleanupError=e.message;report.passed=false;process.exitCode=1});remote.stdin.end();if(remote.exitCode===null)await Promise.race([new Promise(r=>remote.once('exit',r)),new Promise(r=>setTimeout(r,15000).unref())]);report.remoteExitCode=remote.exitCode; if(remote.exitCode===null){remote.kill('SIGTERM');report.remoteForcedStop=true;report.passed=false;process.exitCode=1;}await service?.close();credits?.close();await stderr.close();report.cleanup=report.localCleanupError||report.remoteForcedStop?'unknown':'settled';await save();log('finished',{passed:report.passed});}
