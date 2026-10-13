import { expect, it, vi } from 'vitest';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createPartitionNetwork } from '../../packages/reploid/src/mesh/partitions/partition-network.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { fixture as stageFixture } from '../fixtures/ordered-partition-ports.js';

function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel,index)=>Object.assign(channel,{readyState:'open',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0,
    send(data){queueMicrotask(()=>{if(pair[1-index].readyState==='open')pair[1-index].dispatchEvent(new MessageEvent('message',{data:structuredClone(data)}));});},
    close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));queueMicrotask(()=>pair[1-index].close());}}));
  return pair;
}
it.each([2,3,4,5,6,7])('discovers a complete %i-stage route and serves local plus weightless remote conversations through actual authenticated protocol owners', async count => {
  const f = stageFixture(count), identities = await Promise.all(Array.from({length:count+1}).map(()=>createSigningIdentity({algorithm:'ECDSA'})));
  const listeners = identities.map(()=>new Map()), opens = [], meshes = [], loads = [], models = [{id:f.route.modelId,identity:f.route.modelIdentity,name:'Synthetic'}];
  let signaling = true;
  f.route.stages.forEach((stage,index)=>{stage.participantId=identities[index].peerId;f.stages[index].id=stage.participantId;});
  f.plan.partitions.forEach((stage,index)=>{stage.layerRange=[index*2,index*2+1];});
  f.stages.forEach((stage,index)=>Object.assign(stage,{index,canAccept:()=>true,close:vi.fn(async()=>{}),subscribe:()=>()=>{},
    getState:()=>({ready:true,descriptor:{schema:'doppler.resident-partition/v2',ready:true,index,stageCount:count,
      modelId:models[0].id,modelIdentity:models[0].identity,planId:f.route.planId,layerRange:f.plan.partitions[index].layerRange},
      reservations:{active:0,availableSlots:2,closed:false}})}));
  f.stages[0].tokenize=vi.fn(async()=>({modelIdentity:models[0].identity,tokenIds:[1,2],generation:f.request.generation}));
  const channelPolicy={maxFrameBytes:64,maxControlBytes:131072,maxPayloadBytes:8192,maxPendingBytes:32768,
    maxPendingRequests:16,maxRequestsPerChannel:4096,maxBufferedBytes:262144,maxTransferBytes:16777216,timeoutMs:2000};
  const policy={pollMs:25,maxPeers:16,connectTimeoutMs:2000,grantMs:60000,maxStageOffersPerPeer:4,limits:f.limits,
    receiver:{maxAttempts:32,maxSteps:10},inputChannel:channelPolicy,executionChannel:channelPolicy,controlChannel:channelPolicy,
    inputLimits:{maxInputCharacters:4096,maxOutputCharacters:128,maxAttempts:32,maxConcurrentAttempts:2,descriptorTtlMs:60000}};
  try {
    for (let index=0;index<=count;index++) {
      const transport={getPeerBinding:peer=>({local:`cert-${index}`,remote:`cert-${peer}`}),
        onDataChannel(label,handler){listeners[index].set(label,handler);return()=>listeners[index].delete(label);},
        openDataChannel(peer,label){const target=Number(peer.split('-').at(-1));expect(target).not.toBe(index);
          const pair=channels();opens.push({from:index,to:target,label});
          const receive=listeners[target].get(label);if(!receive)throw Error('Endpoint unavailable');
          receive(`transport-${index}`,pair[1]);return pair[0];}};
      const loadProgram=vi.fn(async()=>({model:models[0],runtime:f.runtime,plan:f.plan,planId:f.route.planId,resident:f.stages[index]}));loads.push(loadProgram);
      meshes.push(createAutomaticPartitions({identity:identities[index],meshId:'mesh',models,policy,
        ordered:{stage:index<count?f.route.stages[index]:null,maxRouteBytes:32768,maxSelectionSteps:256,maxRoutes:4},
        peers:()=>signaling?identities.map((_,i)=>({id:`transport-${i}`,localTransportId:`transport-${index}`})).filter(row=>row.id!==`transport-${index}`):[],
        createNetwork:options=>createPartitionNetwork({...options,transport,verifyPeer:async peer=>identities[Number(peer.split('-').at(-1))].peerId}),loadProgram}));
    }
    for(let index=1;index<count;index++)await meshes[index].contribute(models[0].id,true);
    await meshes[0].contribute(models[0].id,true);
    await vi.waitFor(()=>expect(meshes[count].getModels().some(model=>model.partition?.schema==='reploid.partition-selection/v2')).toBe(true),{timeout:5000});
    const remoteModel=meshes[count].getModels().find(model=>model.partition?.schema==='reploid.partition-selection/v2');
    expect(remoteModel.partition.route).toEqual(f.route);expect(meshes[0].getModels().some(model=>model.partition?.route.stages.length===count)).toBe(true);
    signaling=false;
    const remoteApproval=vi.fn(async()=>true), localApproval=vi.fn(async()=>true), remoteDeltas=[], localDeltas=[], remoteActivity=[], localActivity=[];
    const [remote,local]=await Promise.all([
      meshes[count].generate({model:remoteModel,messages:[{role:'user',content:'Remote synthetic request'}],threadId:'remote',attemptId:'remote'},
        {requestApproval:remoteApproval,onActivity:event=>remoteActivity.push(event),onDelta:event=>remoteDeltas.push(event.text)}),
      meshes[0].generate({model:meshes[0].getModels().find(model=>model.partition?.route.stages[0].participantId===identities[0].peerId),
        messages:[{role:'user',content:'Local synthetic request'}],threadId:'local',attemptId:'local'},
        {requestApproval:localApproval,onActivity:event=>localActivity.push(event),onDelta:event=>localDeltas.push(event.text)})]);
    expect(remote.content).toBe('012');expect(local.content).toBe('012');expect(remoteDeltas.join('')).toBe('012');expect(localDeltas.join('')).toBe('012');
    expect(remoteActivity.map(row=>row.sequence)).toEqual([0,1,2]);expect(localActivity.map(row=>row.sequence)).toEqual([0,1,2]);
    expect(remoteActivity.at(-1).stepSummary.stages).toEqual(remote.execution.stepSummary.stages);expect(localActivity.at(-1).stepSummary.stages).toEqual(local.execution.stepSummary.stages);
    expect(remote.execution.identity.route).toEqual(f.route);expect(local.execution.identity.route).toEqual(f.route);
    expect(remoteApproval.mock.calls[0][0].input.recipients).toEqual([...identities.slice(0,count).map(row=>row.peerId),identities[count].peerId]);
    expect(loads[count]).not.toHaveBeenCalled();expect(loads.slice(0,count).every(load=>load.mock.calls.length===1)).toBe(true);
    expect(opens.some(row=>row.from===row.to)).toBe(false);
    expect(opens.filter(row=>row.label==='reploid-partitions-ordered')).toHaveLength(count-1);
    expect(f.stages.every(stage=>stage.executeStage.mock.calls.length===6 && stage.closeAttempt.mock.calls.length===2)).toBe(true);
    expect(meshes[0].getState().attempts.every(row=>row.cleanup.every(stage=>stage.status==='settled'))).toBe(true);
  } finally {
    const result=await Promise.allSettled(meshes.map(mesh=>mesh.close()));await f.runner.close();
    expect(result.filter(row=>row.status==='rejected')).toEqual([]);
  }
});
