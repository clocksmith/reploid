import { expect, it, vi } from 'vitest';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createPartitionNetwork } from '../../packages/reploid/src/mesh/partitions/partition-network.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { fixture as stageFixture } from '../fixtures/ordered-partition-ports.js';

// Run 7 (2026-10-14): a Mac-side stall closed the coordinator's ordered channels while stage 1 still
// held a reservation. Both contributors stayed up on the same transports, so the route could only
// recover if stage 1 retired its old route channel. It never did: its retirement acknowledgment
// could not be delivered over the closed channel, and every new channel for the route was refused
// ("Ordered route channel already exists"), so capacity never returned without a restart.
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel,index)=>Object.assign(channel,{readyState:'open',ordered:true,maxRetransmits:null,maxPacketLifeTime:null,bufferedAmount:0,
    send(data){queueMicrotask(()=>{if(pair[1-index].readyState==='open')pair[1-index].dispatchEvent(new MessageEvent('message',{data:structuredClone(data)}));});},
    close(){if(this.readyState==='closed')return;this.readyState='closed';this.dispatchEvent(new Event('close'));queueMicrotask(()=>pair[1-index].close());}}));
  return pair;
}
it('re-forms the same route after its ordered channel is lost while both contributors stay up', async () => {
  const count = 3, f = stageFixture(count), identities = await Promise.all(Array.from({length:count}).map(()=>createSigningIdentity({algorithm:'ECDSA'})));
  const listeners = identities.map(()=>new Map()), ordered = [], meshes = [], models = [{id:f.route.modelId,identity:f.route.modelIdentity,name:'Synthetic'}];
  f.route.stages.forEach((stage,index)=>{stage.participantId=identities[index].peerId;f.stages[index].id=stage.participantId;});
  f.plan.partitions.forEach((stage,index)=>{stage.layerRange=[index*2,index*2+1];});
  f.stages.forEach((stage,index)=>Object.assign(stage,{index,canAccept:()=>true,close:vi.fn(async()=>{}),subscribe:()=>()=>{},
    getState:()=>({ready:true,descriptor:{schema:'doppler.resident-partition/v2',ready:true,index,stageCount:count,
      modelId:models[0].id,modelIdentity:models[0].identity,planId:f.route.planId,layerRange:f.plan.partitions[index].layerRange},
      reservations:{active:0,availableSlots:2,closed:false}})}));
  f.stages[0].tokenize=vi.fn(async()=>({modelIdentity:models[0].identity,tokenIds:[1,2],generation:f.request.generation}));
  // Stage 1 holds one attempt mid-step until released.
  let release, reached;
  const held = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { reached = resolve; });
  const execute = f.stages[1].executeStage.getMockImplementation();
  f.stages[1].executeStage.mockImplementation(async args => {
    if (args.identity.attemptId === 'held') { reached(); await held; }
    return execute(args);
  });
  const channelPolicy={maxFrameBytes:64,maxControlBytes:131072,maxPayloadBytes:8192,maxPendingBytes:32768,
    maxPendingRequests:16,maxRequestsPerChannel:4096,maxBufferedBytes:262144,maxTransferBytes:16777216,timeoutMs:2000};
  const policy={pollMs:25,maxPeers:16,connectTimeoutMs:2000,grantMs:60000,maxStageOffersPerPeer:4,limits:f.limits,
    receiver:{maxAttempts:32,maxSteps:10},inputChannel:channelPolicy,executionChannel:channelPolicy,controlChannel:channelPolicy,
    inputLimits:{maxInputCharacters:4096,maxOutputCharacters:128,maxAttempts:32,maxConcurrentAttempts:2,descriptorTtlMs:60000}};
  const local = () => meshes[0].getModels().find(model=>model.partition?.route.stages.length===count);
  const ask = attemptId => meshes[0].generate({model:local(),messages:[{role:'user',content:'Synthetic request'}],threadId:attemptId,attemptId},
    {requestApproval:async()=>true});
  try {
    for (let index=0;index<count;index++) {
      const transport={getPeerBinding:peer=>({local:`cert-${index}`,remote:`cert-${peer}`}),
        onDataChannel(label,handler){listeners[index].set(label,handler);return()=>listeners[index].delete(label);},
        openDataChannel(peer,label){const target=Number(peer.split('-').at(-1));
          const pair=channels();if(label==='reploid-partitions-ordered')ordered.push({from:index,to:target,pair});
          const receive=listeners[target].get(label);if(!receive)throw Error('Endpoint unavailable');
          receive(`transport-${index}`,pair[1]);return pair[0];}};
      meshes.push(createAutomaticPartitions({identity:identities[index],meshId:'mesh',models,policy,
        ordered:{stage:f.route.stages[index],maxRouteBytes:32768,maxSelectionSteps:256,maxRoutes:4},
        peers:()=>identities.map((_,i)=>({id:`transport-${i}`,localTransportId:`transport-${index}`})).filter(row=>row.id!==`transport-${index}`),
        createNetwork:options=>createPartitionNetwork({...options,transport,verifyPeer:async peer=>identities[Number(peer.split('-').at(-1))].peerId}),
        loadProgram:vi.fn(async()=>({model:models[0],runtime:f.runtime,plan:f.plan,planId:f.route.planId,resident:f.stages[index]}))}));
    }
    for(let index=1;index<count;index++)await meshes[index].contribute(models[0].id,true);
    await meshes[0].contribute(models[0].id,true);
    await vi.waitFor(()=>expect(local()).toBeTruthy(),{timeout:5000});
    expect((await ask('first')).content).toBe('012');

    const pending = ask('held'); pending.catch(()=>{});
    await entered;
    const link = ordered.find(row=>row.from===0&&row.to===1&&row.pair[0].readyState==='open');
    link.pair[0].close();
    await expect(pending).rejects.toMatchObject({ code: 'CONNECTION_LOST' });
    release();
    // Stage 1 settles its own resident for the lost attempt; nobody restarts.
    await vi.waitFor(()=>expect(f.stages[1].closeAttempt.mock.calls.some(([request])=>request.identity.attemptId==='held')).toBe(true),{timeout:5000});
    // The coordinator keeps the lost stage as unknown, and the same route becomes ready again.
    await vi.waitFor(()=>expect(local()).toBeTruthy(),{timeout:8000});
    expect((await ask('after')).content).toBe('012');
    const lost = meshes[0].getState().unknownAttempts.find(row=>row.identity.attemptId==='held');
    expect(lost.cleanup.find(row=>row.partitionIndex===1)).toMatchObject({ status: 'unknown', code: 'CONNECTION_LOST' });
  } finally {
    release();
    await Promise.allSettled(meshes.map(mesh=>mesh.close())); await f.runner.close();
  }
}, 30000);
