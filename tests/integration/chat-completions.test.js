// @vitest-environment node
import http from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createStandaloneSignalingServer } from '../../server/reploid-signaling.js';
import { createChatCompletions, parseTextChatCompletion } from '../../server/chat-completions.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
const preview = (request, recipients=['stage']) => ({threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,recipients,input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}});
const model = { id:'test-model',identity:'sha256:'+'a'.repeat(64),partition:{prepared:true} };
const input = {model:model.id,messages:[{role:'user',content:'hello'}]};
const owners=[];
afterEach(async()=>{for(const close of owners.splice(0).reverse()) await close();});
async function boot(overrides={}) {
  const generate=vi.fn(async (request,controls)=>{
    if(!await controls.requestApproval(preview(request,['actual-stage']))) throw Error('Disclosure declined');
    for(const [sequence,text] of ['hel','lo'].entries()) controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence,text});
    return {threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,
      content:'hello',execution:{stopReason:'eos-token'}};
  });
  const authorize=vi.fn(async()=>true), authenticate=vi.fn(async req=>req.headers.authorization==='Bearer test-token'?{subject:'user-1'}:null);
  const participant={getState:()=>({models:[model]}),generate,...overrides.participant};
  const fallback=vi.fn(()=>{throw Error('Unexpected fallback');});
  const chatCompletions=createChatCompletions({authenticate,authorize,...overrides,participant});
  const server=http.createServer(chatCompletions.handle);
  const app={server,chatCompletions,async close(){await chatCompletions.close();server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));}};
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  owners.push(()=>app.close());
  const url=`http://127.0.0.1:${app.server.address().port}/v1/chat/completions`;
  const post=(body=input,options={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-token'},body:JSON.stringify(body),...options});
  return {app,url,post,generate,authorize,authenticate,participant,fallback};
}
it('requires explicit authentication and disclosure ports',()=>{
  expect(()=>createChatCompletions({participant:{generate(){},getState(){}}})).toThrow('authentication/authorization');
});
it.each(['tools','tool_choice','response_format','temperature','seed','top_p','max_tokens','n','stream_options'])('rejects unsupported %s explicitly',parameter=>{
  expect(()=>parseTextChatCompletion({...input,[parameter]:null})).toThrow(`Unsupported parameter: ${parameter}`);
});
it.each([{role:'tool',content:'x'},{role:'developer',content:'x'},{role:'user',content:[{type:'text',text:'x'}]},{role:'assistant',content:'x',tool_calls:[]}])('rejects unsupported message shape %j',message=>{
  expect(()=>parseTextChatCompletion({...input,messages:[message]})).toThrow('Only system/user/assistant');
});
it('mounted route authenticates exact immutable request and disclosure then returns bound completion without usage guesses',async()=>{
  const f=await boot();const response=await f.post();expect(response.status).toBe(200);const result=await response.json();
  expect(result).toMatchObject({object:'chat.completion',model:model.id,choices:[{index:0,message:{role:'assistant',content:'hello'},finish_reason:'stop'}]});
  expect(result.usage).toBeUndefined();expect(response.headers.get('x-reploid-model-identity')).toBe(model.identity);
  expect(f.authorize.mock.calls.map(([row])=>row.action)).toEqual(['chat.execute','chat.disclose']);
  expect(f.authorize.mock.calls[1][0]).toMatchObject({principal:{subject:'user-1'},preview:{recipients:['actual-stage']}});
  expect(Object.isFrozen(f.generate.mock.calls[0][0].messages)).toBe(true);expect(f.fallback).not.toHaveBeenCalled();
});
it('streams ordered deltas and one terminal reason with a stable completion identity',async()=>{
  const f=await boot();const response=await f.post({...input,stream:true});expect(response.headers.get('content-type')).toContain('text/event-stream');
  const rows=(await response.text()).trim().split('\n\n').map(row=>row.slice(6));expect(rows.pop()).toBe('[DONE]');
  const chunks=rows.map(JSON.parse);expect(new Set(chunks.map(row=>row.id)).size).toBe(1);
  expect(chunks.map(row=>row.choices[0].delta.content||'').join('')).toBe('hello');
  expect(chunks[0].choices[0].delta.role).toBe('assistant');expect(chunks.at(-1).choices[0].finish_reason).toBe('stop');
});
it.each([['stop-token','stop'],['stop-sequence','stop'],['max-tokens','length'],['context-limit','length']])('maps actual %s termination to %s',async(reason,expected)=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(preview(request));return {...request,modelId:model.id,modelIdentity:model.identity,content:'text',execution:{stopReason:reason}};}}});
  const response=await f.post();expect((await response.json()).choices[0].finish_reason).toBe(expected);
});
it('rejects unknown termination and a changed result identity instead of claiming successful completion',async()=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(preview(request));return {...request,modelId:model.id,modelIdentity:model.identity,content:'text',execution:{stopReason:'unknown'}};}}});
  expect((await f.post()).status).toBe(502);
  f.participant.generate=async request=>({...request,attemptId:'other',modelId:model.id,modelIdentity:model.identity,content:'text',execution:{stopReason:'stop-token'}});
  expect((await f.post()).status).toBe(502);
});
it('unauthenticated and denied calls never execute or fall back',async()=>{
  const f=await boot();expect((await f.post(input,{headers:{'content-type':'application/json'}})).status).toBe(401);
  f.authorize.mockResolvedValue(false);expect((await f.post()).status).toBe(403);
  expect(f.generate).not.toHaveBeenCalled();expect(f.fallback).not.toHaveBeenCalled();
});
it('disconnect propagates abort and retains HTTP admission while execution remains unresolved',async()=>{
  const entered=Promise.withResolvers(), release=Promise.withResolvers();let executionSignal;
  const f=await boot({participant:{generate:async(request,controls)=>{executionSignal=controls.signal;entered.resolve();await release.promise;throw Error('settlement failed');}}});
  const controller=new AbortController(), response=f.post(input,{signal:controller.signal});response.catch(()=>{});
  await entered.promise;controller.abort();await expect(response).rejects.toThrow();
  await vi.waitFor(()=>expect(executionSignal.aborted).toBe(true));
  expect(f.app.chatCompletions.getState()).toMatchObject({active:1,scope:'http-requests'});
  release.resolve();await vi.waitFor(()=>expect(f.app.chatCompletions.getState().active).toBe(0));
});
it('disconnect while host authentication awaits never proceeds to execution',async()=>{
  const entered=Promise.withResolvers(), release=Promise.withResolvers();let authSignal;
  const f=await boot({authenticate:async(req,{signal})=>{authSignal=signal;entered.resolve();await release.promise;return {subject:'late'};}});
  const controller=new AbortController(), request=f.post(input,{signal:controller.signal});request.catch(()=>{});
  await entered.promise;controller.abort();await expect(request).rejects.toThrow();
  await vi.waitFor(()=>expect(authSignal.aborted).toBe(true));expect(f.app.chatCompletions.getState().active).toBe(1);
  release.resolve();await vi.waitFor(()=>expect(f.app.chatCompletions.getState().active).toBe(0));expect(f.generate).not.toHaveBeenCalled();
});
it('disconnect during an incomplete JSON body releases admission without calling requester',async()=>{
  const f=await boot();const request=http.request(f.url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-token'}});
  request.on('error',()=>{});request.write('{"model":');
  await vi.waitFor(()=>expect(f.app.chatCompletions.getState().active).toBe(1));request.destroy();
  await vi.waitFor(()=>expect(f.app.chatCompletions.getState().active).toBe(0));expect(f.generate).not.toHaveBeenCalled();
});
it('actual mounted handler reaches weightless automatic requester, signed grants and all ordered stages',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();
  await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const f=await boot({participant:mesh.meshes[5]});
  const response=await f.post({model:mesh.model.id,messages:[{role:'user',content:tasks[0].prompt}],stream:true});
  expect(response.status).toBe(200);const rows=(await response.text()).trim().split('\n\n').map(row=>row.slice(6));expect(rows.pop()).toBe('[DONE]');
  expect(rows.map(JSON.parse).map(row=>row.choices[0].delta.content||'').join('')).toBe(tasks[0].chunks.join(''));
  expect(mesh.loads[5]).not.toHaveBeenCalled();expect(mesh.states[0].resident.executeStage).toHaveBeenCalledTimes(3);
  expect(mesh.states[1].resident.executeStage).toHaveBeenCalledTimes(3);expect(mesh.states[2].resident.executeStage).toHaveBeenCalledTimes(3);
  expect(mesh.states.every(row=>row.attempts.size===0)).toBe(true);expect(f.authorize.mock.calls[1][0].preview.disclosure).toBeTruthy();
});
it('streamed partial output with unknown stopping reason ends in an error without a successful DONE',async()=>{
  const f=await boot({participant:{generate:async(request,controls)=>{
    await controls.requestApproval(preview(request));
    controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'partial'});
    return {...request,modelId:model.id,modelIdentity:model.identity,content:'partial',execution:{stopReason:'unknown'}};
  }}});
  const response=await f.post({...input,stream:true}), text=await response.text();
  expect(text).toContain('partial');expect(text).toContain('termination reason unavailable');expect(text).not.toContain('[DONE]');
});
it('disconnect while execution authorization awaits cannot dispatch a late approved request',async()=>{
  const entered=Promise.withResolvers(), release=Promise.withResolvers();let approvalSignal;
  const f=await boot({authorize:async({signal})=>{approvalSignal=signal;entered.resolve();await release.promise;return true;}});
  const controller=new AbortController(), request=f.post(input,{signal:controller.signal});request.catch(()=>{});
  await entered.promise;controller.abort();await expect(request).rejects.toThrow();
  await vi.waitFor(()=>expect(approvalSignal.aborted).toBe(true));expect(f.app.chatCompletions.getState().active).toBe(1);
  release.resolve();await vi.waitFor(()=>expect(f.app.chatCompletions.getState().active).toBe(0));expect(f.generate).not.toHaveBeenCalled();
});
it('does not mount the compatibility endpoint by default',async()=>{
  const app=createStandaloneSignalingServer({port:0,swarmInferencePeer:null,inferenceService:{isPeerAvailable:()=>false,getProxyStatus:()=>({})}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));owners.push(()=>app.close());
  const response=await fetch(`http://127.0.0.1:${app.server.address().port}/v1/chat/completions`,{method:'POST'});
  expect(response.status).toBe(404);expect(app.chatCompletions).toBeUndefined();
});

it('execution approval cannot substitute for denied actual recipient disclosure',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();
  await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const authorize=vi.fn(async ({action})=>action==='chat.execute');
  const f=await boot({participant:mesh.meshes[5],authorize});
  const response=await f.post({model:mesh.model.id,messages:[{role:'user',content:tasks[0].prompt}]});
  expect(response.status).toBe(403);expect(authorize.mock.calls.map(([row])=>row.action)).toEqual(['chat.execute','chat.disclose']);
  expect(authorize.mock.calls[1][0].preview.disclosure).toBeTruthy();
  expect(mesh.states.filter(row=>row.resident).every(row=>row.resident.executeStage.mock.calls.length===0)).toBe(true);
});

it('bounds HTTP admission and leaves borrowed owner closure to its caller',async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let count=0;const close=vi.fn(),signals=[];
  const f=await boot({participant:{close,generate:async(request,{signal})=>{signals.push(signal);if(++count===2)entered.resolve();await release.promise;throw Error('still failed');}}});
  const a=f.post(),b=f.post();await entered.promise;
  expect((await f.post()).status).toBe(429);expect(f.app.chatCompletions.getState().active).toBe(2);
  let settled=false;const stopping=f.app.chatCompletions.close().then(()=>{settled=true;});
  await Promise.resolve();expect(settled).toBe(false);expect(signals.every(signal=>signal.aborted)).toBe(true);
  release.resolve();await Promise.all([a,b,stopping]);expect(f.app.chatCompletions.getState().active).toBe(0);expect(close).not.toHaveBeenCalled();
});

it('normalizes a host failure without an Error object into an explicit HTTP failure',async()=>{
  const f=await boot({authenticate:async()=>{throw null;}});
  const response=await f.post();expect(response.status).toBe(502);expect((await response.json()).error.message).toBe('Requester failed');
  expect(f.generate).not.toHaveBeenCalled();
});
