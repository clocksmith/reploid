import { expect, it, vi } from 'vitest';
import { disclosureScope, matchingThreadGrant, validateThreadGrants } from '../../packages/reploid/src/chat/thread-grants.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

const digest = c => 'sha256:' + c.repeat(64), peer = c => 'peer:' + c.repeat(24);
function previewFixture(count = 3) {
  const requester = peer('f');
  const route = { schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: digest('a'), planId: digest('b'),
    activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 8, precision: 'f32', components: 1, elementStrideBytes: 4 },
    stages: Array.from({length:count},(_,index)=>({index,participantId:peer(String(index)),transportId:'transport-'+index,residentId:'resident-'+index,executionId:'execution-'+index})) };
  const partition = {schema:'reploid.partition-selection/v2',planId:route.planId,coordinatorId:route.stages[0].participantId,route};
  const request = {model:{id:route.modelId,identity:route.modelIdentity,adapters:[],partition},permissions:{sharingScope:'mesh'}};
  const disclosure = orderedPartitionDisclosure({schema:'reploid.partition-attempt/v2',threadId:'thread',attemptId:'attempt',requesterId:requester,placementGeneration:0,route});
  const preview = {...partition,threadId:'thread',attemptId:'attempt',operation:'generate-partition',peerId:partition.coordinatorId,recipientIdentity:partition.coordinatorId,
    modelId:route.modelId,modelIdentity:route.modelIdentity,adapterIdentities:[],disclosure,
    input:{recipients:[...new Set([...disclosure.tokenRecipients,...disclosure.outputRecipients])]}};
  return {request,preview,requester};
}

it.each([2,3,7])('binds an ordered %i-stage disclosure to every route identity and recipient', count => {
  const f=previewFixture(count), scope=disclosureScope(f.request,f.preview,f.requester);
  expect(scope).toMatchObject({disclosure:'ordered-partition-activations-and-tokens',route:f.preview.route,requesterIdentity:f.requester});
  const grant={...scope,id:'grant',meshId:'mesh',threadId:'thread',createdAt:1,revokedAt:null};
  expect(()=>validateThreadGrants([grant],'thread','mesh',4,f.requester)).not.toThrow();
  expect(matchingThreadGrant([grant],scope)).toEqual(grant);
  // Reordering object keys does not change the reviewed execution identity.
  const reordered={...scope,route:Object.fromEntries(Object.entries(scope.route).reverse())};
  expect(matchingThreadGrant([grant],reordered)).toEqual(grant);
  for (const field of ['participantId','transportId','residentId','executionId']) {
    const changed=structuredClone(scope); changed.route.stages[1][field]=field==='participantId'?peer('e'):'replacement';
    expect(matchingThreadGrant([grant],changed)).toBeUndefined();
  }
  const changed=structuredClone(grant);changed.requesterIdentity=peer('d');
  expect(()=>validateThreadGrants([changed],'thread','mesh',4,f.requester)).toThrow('Invalid stored conversation grants');
});

it('rejects malformed or broadened ordered disclosure before reusable authorization',()=>{
  const f=previewFixture();
  const mutations=[
    p=>p.input.recipients.pop(),p=>p.input.recipients.push(peer('e')),
    p=>p.disclosure.tokenRecipients.reverse(),p=>p.disclosure.outputRecipients.push(peer('e')),
    p=>p.disclosure.activationPaths[1].splice(1,1),p=>p.disclosure.extra=true,
    p=>p.peerId=peer('e'),p=>p.recipientIdentity=peer('e'),p=>p.coordinatorId=peer('e'),
    p=>p.planId=digest('c'),p=>p.route.stages[1].index=0,p=>p.route.modelIdentity=digest('c')
  ];
  for (const mutate of mutations) {const preview=structuredClone(f.preview);mutate(preview);expect(disclosureScope(f.request,preview,f.requester)).toBeNull();}
  expect(disclosureScope(f.request,f.preview,peer('e'))).toBeNull();
  expect(disclosureScope(f.request,f.preview)).toBeNull();
});

it('uses Send authorization and remembers/restores the exact actual ordered route',async()=>{
  const f=await automaticOrderedMesh();let saved;const apps=[];
  const options={meshId:'mesh',participantId:f.identities[5].peerId,store:{load:()=>structuredClone(saved),save:value=>{saved=structuredClone(value);}},
    execute:(request,controls)=>f.meshes[5].generate(request,controls)};
  let primary;
  try {
    await f.prepare();await vi.waitFor(()=>expect(f.select(5,0)).toBeTruthy(),{timeout:5000});
    const app=createChatWorkspace(options);apps.push(app);
    const thread=app.createThread({model:f.select(5,0),permissions:{sharingScope:'mesh'}}), authorize=vi.fn(()=>true);
    const first=await app.send(thread,tasks[0].prompt,{authorizeDisclosure:authorize});
    expect(first.status).toBe('completed');expect(authorize).toHaveBeenCalledOnce();
    expect(first.authorization).toMatchObject({source:'send',requesterIdentity:f.identities[5].peerId});
    const second=app.send(thread,tasks[0].prompt);
    await vi.waitFor(()=>expect(app.getState().threads[0].attempts.at(-1).status).toBe('approval'));
    const attempt=app.getState().threads[0].attempts.at(-1);expect(attempt.approval.reusable).toBe(true);
    app.approve(thread,attempt.id,attempt.approval.id,true,{remember:true});expect((await second).status).toBe('completed');
    await app.close();
    const restored=createChatWorkspace(options);apps.push(restored);
    const follow=await restored.send(thread,tasks[0].prompt);expect(follow.status).toBe('completed');expect(follow.authorization.kind).toBe('thread-grant');
    expect(f.loads[5]).not.toHaveBeenCalled();
    const grant=restored.getState().threads[0].grants[0];restored.revokeGrant(thread,grant.id);
    const stopped=restored.send(thread,tasks[0].prompt);
    await vi.waitFor(()=>expect(restored.getState().threads[0].attempts.at(-1).status).toBe('approval'));
    await restored.cancel(thread);expect((await stopped).status).toBe('cancelled');
  }catch(error){primary=error;}finally{
    const cleanup=await Promise.allSettled(apps.map(app=>app.close()));
    try{await f.close();}catch(error){cleanup.push({status:'rejected',reason:error});}
    const failures=cleanup.filter(item=>item.status==='rejected').map(item=>item.reason);
    if(primary||failures.length)throw new AggregateError([...(primary?[primary]:[]),...failures],'Ordered grant control failed');
  }
},20000);
