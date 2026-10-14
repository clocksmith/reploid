// @vitest-environment node
import http from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createMessages, parseTextMessage } from '../../server/messages.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
const capability={schema:'reploid.text-generation/v1',usage:'raw-model-tokens/v1'};
const preview = (request, recipients=['stage']) => ({threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,recipients,input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}});
const model={id:'test-model',identity:'sha256:'+'a'.repeat(64),partition:{prepared:true},textGeneration:capability};
const input={model:model.id,messages:[{role:'user',content:'hello'}],max_tokens:2},owners=[];
afterEach(async()=>{for(const close of owners.splice(0).reverse())await close();});
async function boot(overrides={}){
  const generate=vi.fn(async(request,controls)=>{await controls.requestApproval(preview(request,['actual-stage']));
    await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:0});
    controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'hello'});
    return {threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,content:'hello',
      usage:{schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:1},execution:{stopReason:'stop-token',stepSummary:{count:1}}};
  });
  const participant={getState:()=>({models:[model]}),generate,...overrides.participant};
  const authenticate=vi.fn(async req=>req.headers['x-api-key']==='local-token'?{subject:'local-user'}:null),authorize=vi.fn(async()=>true);
  const api=createMessages({authenticate,authorize,...overrides,participant}),server=http.createServer(api.handle);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));owners.push(async()=>{await api.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/v1/messages`,post=(body=input,options={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json','x-api-key':'local-token','anthropic-version':'2023-06-01'},body:JSON.stringify(body),...options});
  return{api,post,url,generate,participant,authenticate,authorize};
}
const events=text=>text.trim().split('\n\n').map(frame=>{const[event,data]=frame.split('\n');const row=JSON.parse(data.slice(6));expect(event).toBe(`event: ${row.type}`);return row;});
it.each(['tools','tool_choice','thinking','output_config','temperature','top_p','top_k','seed','stop_sequences','metadata','service_tier','container'])('rejects unsupported %s',param=>expect(()=>parseTextMessage({...input,[param]:null})).toThrow(`Unsupported parameter: ${param}`));
it.each([undefined,0,-1,1.5,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1])('rejects unsupported output ceiling %s before generation',max_tokens=>expect(()=>parseTextMessage({...input,max_tokens})).toThrow('max_tokens'));
it.each([[{role:'assistant',content:'prefill'}],[{role:'system',content:'hidden'}],[{role:'user',content:'a'},{role:'user',content:'b'}],[{role:'user',content:[{type:'text',text:'a'}]}]])('rejects unsupported prompt shape %j',messages=>expect(()=>parseTextMessage({...input,messages})).toThrow());
it('authenticates immutable caller ceiling, actual disclosure and input/output token observations',async()=>{
  const f=await boot(),response=await f.post({...input,system:'be terse'}),body=await response.json();expect(response.status).toBe(200);
  expect(body).toMatchObject({type:'message',role:'assistant',model:model.id,content:[{type:'text',text:'hello'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:7,output_tokens:1}});
  const request=f.generate.mock.calls[0][0];expect(Object.isFrozen(request.generationRequest)).toBe(true);expect(request.generationRequest.maxOutputTokens).toBe(2);
  expect(request.messages[0]).toEqual({role:'system',content:'be terse'});expect(f.authorize.mock.calls.map(([row])=>row.action)).toEqual(['chat.execute','chat.disclose']);
});
it('streams observed input usage before text and final cumulative raw output count',async()=>{
  const f=await boot(),rows=events(await(await f.post({...input,stream:true})).text());
  expect(rows.map(r=>r.type)).toEqual(['message_start','content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']);
  expect(rows[0].message.usage).toEqual({input_tokens:7,output_tokens:0});expect(rows[4]).toMatchObject({delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:1}});
});
it('actual HTTP/automatic/grant/peer chain enforces a smaller cap and reports tokenizer and sampler counts',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const last=mesh.states[2].resident,execute=last.executeStage.getMockImplementation();
  last.executeStage.mockImplementation(async request=>({...await execute(request),done:request.step+1===request.maxTokens,stopReason:'max-tokens'}));
  const f=await boot({participant:mesh.meshes[5]}),response=await f.post({model:mesh.model.id,messages:[{role:'user',content:tasks[0].prompt}],max_tokens:2,stream:true});
  expect(response.status).toBe(200);const rows=events(await response.text());expect(rows[0].message.usage).toEqual({input_tokens:2,output_tokens:0});
  expect(rows.at(-2)).toMatchObject({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:2}});expect(last.executeStage).toHaveBeenCalledTimes(2);
  expect(last.executeStage.mock.calls.every(([r])=>r.maxTokens===2&&r.generation.maxTokens===2)).toBe(true);expect(mesh.states.every(row=>row.attempts.size===0)).toBe(true);
  expect(f.authorize.mock.calls[1][0].preview.input.generationRequest.maxOutputTokens).toBe(2);
});
it('recipient denial after execution approval dispatches no stages',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const f=await boot({participant:mesh.meshes[5],authorize:async({action})=>action==='chat.execute'});
  expect((await f.post({model:mesh.model.id,messages:[{role:'user',content:tasks[0].prompt}],max_tokens:2})).status).toBe(403);
  expect(mesh.states.filter(row=>row.resident).every(row=>row.resident.executeStage.mock.calls.length===0)).toBe(true);
});
it.each(['missing','late','different-attempt','duplicate','changed-final','over-cap'])('refuses %s usage rather than inventing protocol counts',async kind=>{
  const f=await boot();f.participant.generate=async(request,controls)=>{
    await controls.requestApproval(preview(request));
    const event={threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:7,outputTokens:0};
    const delta=()=>controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'x'});
    if(kind==='late')delta();if(kind==='different-attempt')event.attemptId='wrong';
    if(kind!=='missing')await controls.onUsage(event);if(kind==='duplicate')await controls.onUsage(event);if(kind!=='late')delta();
    return {...request,modelId:model.id,modelIdentity:model.identity,content:'x',execution:{stopReason:'stop-token',stepSummary:{count:1}},usage:{schema:'raw-model-tokens/v1',inputTokens:kind==='changed-final'?8:7,outputTokens:kind==='over-cap'?3:1}};
  };
  const response=await f.post({...input,stream:true});if(response.status===200){const rows=events(await response.text());expect(rows.at(-1).type).toBe('error');expect(rows.some(r=>r.type==='message_stop')).toBe(false);}else expect(response.status).toBe(502);
});
it('cancellation keeps unresolved HTTP admission charged and cannot publish a late terminal',async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let signal;
  const f=await boot({participant:{generate:async(request,controls)=>{signal=controls.signal;entered.resolve();await release.promise;throw Error('unsettled owner');}}});
  const controller=new AbortController(),request=f.post(input,{signal:controller.signal});request.catch(()=>{});await entered.promise;controller.abort();await expect(request).rejects.toThrow();
  await vi.waitFor(()=>expect(signal.aborted).toBe(true));expect(f.api.getState().active).toBe(1);release.resolve();await vi.waitFor(()=>expect(f.api.getState().active).toBe(0));
});
it('does not invent counts for an old route, accepts no unauthorized request and rejects unknown protocol headers',async()=>{
  const f=await boot({participant:{getState:()=>({models:[{...model,textGeneration:undefined}]})}});expect((await f.post()).status).toBe(502);expect(f.generate).not.toHaveBeenCalled();
  const denied=await f.post(input,{headers:{'content-type':'application/json'}});expect(denied.status).toBe(401);expect((await denied.json()).error.type).toBe('authentication_error');
  expect((await f.post(input,{headers:{'content-type':'application/json','x-api-key':'local-token','anthropic-version':'unknown'}})).status).toBe(400);
});
it.each(['missing','pending','denied'])('refuses output while disclosure is %s even if borrowed provider violates callback contract',async mode=>{
  const gate=Promise.withResolvers(),f=await boot({authorize:async({action})=>action==='chat.execute'?true:mode==='pending'?gate.promise:false});
  f.participant.generate=async(request,controls)=>{
    if(mode!=='missing'){const approval=controls.requestApproval(preview(request,['unapproved']));approval.catch(()=>{});if(mode==='denied')await approval.catch(()=>{});}
    await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:1,outputTokens:0});
    throw Error('should not get here');
  };
  try{const response=await f.post({...input,stream:true}),text=await response.text();expect(response.status).toBe(mode==='denied'?403:502);expect(text).not.toContain('message_start');expect(text).not.toContain('message_stop');}finally{gate.resolve(true);}
});
it.each(['input','output','schema'])('validates final-only %s usage before emitting fallback text',async field=>{
  const f=await boot();f.participant.generate=async(request,controls)=>{
    await controls.requestApproval(preview(request,['approved']));await controls.onUsage({threadId:request.threadId,attemptId:request.attemptId,schema:'raw-model-tokens/v1',inputTokens:2,outputTokens:0});
    return {...request,modelId:model.id,modelIdentity:model.identity,content:'UNVALIDATED_FINAL_TEXT',execution:{stopReason:'stop-token',stepSummary:{count:1}},
      usage:{schema:field==='schema'?'wrong':'raw-model-tokens/v1',inputTokens:field==='input'?3:2,outputTokens:field==='output'?0:1}};
  };
  const text=await(await f.post({...input,stream:true})).text();expect(text).toContain('event: error');expect(text).not.toContain('UNVALIDATED_FINAL_TEXT');expect(text).not.toContain('message_stop');
});
it.each(['thread','attempt','model','messages','cap'])('unrelated disclosure %s cannot unlock output',async field=>{
  const f=await boot();f.participant.generate=async(request,controls)=>{
    const p=structuredClone(preview(request));if(field==='thread')p.threadId='other';if(field==='attempt')p.attemptId='other';if(field==='model')p.modelIdentity='other';if(field==='messages')p.input.messages[0].content='different';if(field==='cap')p.input.generationRequest.maxOutputTokens++;
    await controls.requestApproval(p);throw Error('should not execute');
  };
  const response=await f.post({...input,stream:true});expect(response.status).toBe(502);expect(f.authorize.mock.calls.map(([row])=>row.action)).toEqual(['chat.execute']);
});
it('callbacks retained by a completed provider cannot publish late output or approval',async()=>{
  const f=await boot(),generate=f.participant.generate;let request,controls;
  f.participant.generate=async(r,c)=>{request=r;controls=c;return generate(r,c);};
  expect((await f.post()).status).toBe(200);await vi.waitFor(()=>expect(f.api.getState().active).toBe(0));
  expect(()=>controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:1,text:'late'})).toThrow();
  await expect(controls.requestApproval(preview(request))).rejects.toThrow();expect(f.authorize).toHaveBeenCalledTimes(2);
});
