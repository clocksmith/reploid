// @vitest-environment node
import http from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { createResponses, parseTextResponse } from '../../server/responses.js';
import { createChatCompletions } from '../../server/chat-completions.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
const preview = (request, recipients=['stage']) => ({threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,modelIdentity:request.model.identity,recipients,input:{messages:request.messages,...(request.generationRequest?{generationRequest:request.generationRequest}:{})}});
const model={id:'test-model',identity:'sha256:'+'a'.repeat(64),partition:{prepared:true}};
const input={model:model.id,input:'hello',store:false}, owners=[];
afterEach(async()=>{for(const close of owners.splice(0).reverse())await close();});
const result=(request,content='hello',reason='eos-token')=>({threadId:request.threadId,attemptId:request.attemptId,modelId:request.model.id,
  modelIdentity:request.model.identity,content,execution:{stopReason:reason}});
async function boot(overrides={}){
  const generate=vi.fn(async(request,controls)=>{await controls.requestApproval(preview(request,['actual-stage']));
    for(const [sequence,text] of ['hel','lo'].entries())controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence,text});
    return result(request);
  });
  const participant={getState:()=>({models:[model]}),generate,...overrides.participant};
  const authenticate=vi.fn(async req=>req.headers.authorization==='Bearer local-token'?{subject:'local-user'}:null);
  const authorize=vi.fn(async()=>true), options={authenticate,authorize,...overrides,participant};
  const api=createResponses(options),chat=createChatCompletions(options);
  const server=http.createServer((req,res)=>req.url==='/v1/chat/completions'?chat.handle(req,res):api.handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  owners.push(async()=>{await Promise.all([api.close(),chat.close()]);server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));});
  const url=`http://127.0.0.1:${server.address().port}/v1/responses`;
  const post=(body=input,options={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer local-token'},body:JSON.stringify(body),...options});
  return{api,chat,participant,generate,authenticate,authorize,post,url};
}
const events=text=>text.trim().split('\n\n').map(frame=>{const [event,data]=frame.split('\n');const row=JSON.parse(data.slice(6));expect(event).toBe(`event: ${row.type}`);return row;});
it.each(['previous_response_id','conversation','background','tools','tool_choice','text','response_format','temperature','top_p','seed','max_output_tokens','metadata','stream_options'])('rejects unsupported %s without executing',param=>{
  expect(()=>parseTextResponse({...input,[param]:null})).toThrow(`Unsupported parameter: ${param}`);
});
it.each([undefined,true,null])('requires explicit store:false, rejects %s',store=>expect(()=>parseTextResponse({...input,store})).toThrow('store:false'));
it.each([[],Array(129).fill({role:'user',content:'x'}),[{role:'developer',content:'x'}],[{role:'tool',content:'x'}],[{role:'user',content:[{type:'input_text',text:'x'}]}],[{type:'function_call_output',role:'user',content:'x'}],[{role:'user',content:'x',id:'prior'}]])('rejects unimplemented input shape %j',value=>expect(()=>parseTextResponse({...input,input:value,instructions:'system'})).toThrow());
it('mounted route binds instructions and messages to actual authorization, preserving response identity without usage guesses',async()=>{
  const f=await boot(),response=await f.post({...input,instructions:'be concise',input:[{type:'message',role:'assistant',content:'prior'},{role:'user',content:'hello'}]});
  expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({object:'response',model:model.id,status:'completed',store:false,error:null,incomplete_details:null,
    output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'hello'}]}]});
  expect(body.usage).toBeUndefined();expect(body.completed_at).toBeTypeOf('number');expect(response.headers.get('x-reploid-model-identity')).toBe(model.identity);
  expect(f.authorize.mock.calls.map(([r])=>r.action)).toEqual(['chat.execute','chat.disclose']);
  const request=f.generate.mock.calls[0][0];expect(request.messages).toEqual([{role:'system',content:'be concise'},{role:'assistant',content:'prior'},{role:'user',content:'hello'}]);
  expect(Object.isFrozen(request.messages)).toBe(true);expect(f.authorize.mock.calls[1][0].request).toBe(request);
});
it('streams contiguous typed events with one stable item and a genuine completed terminal',async()=>{
  const f=await boot(),rows=events(await(await f.post({...input,stream:true})).text());
  expect(rows.map(r=>r.type)).toEqual(['response.created','response.in_progress','response.output_item.added','response.content_part.added','response.output_text.delta','response.output_text.delta','response.output_text.done','response.content_part.done','response.output_item.done','response.completed']);
  expect(rows.map(r=>r.sequence_number)).toEqual(rows.map((_,i)=>i));expect(new Set(rows.filter(r=>r.response).map(r=>r.response.id)).size).toBe(1);
  const id=rows[2].item.id;expect(rows.filter(r=>r.item_id).every(r=>r.item_id===id&&r.output_index===0&&r.content_index===0)).toBe(true);
  expect(rows[3].part.text).toBe('');expect(rows.filter(r=>r.type==='response.output_text.delta').map(r=>r.delta).join('')).toBe('hello');
  expect(rows.at(-1).response.output[0].id).toBe(id);expect(rows.at(-1).response.usage).toBeUndefined();
});
it.each([false,true])('max-tokens emits incomplete not completed (stream=%s)',async stream=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(preview(request));return result(request,'partial','max-tokens');}}}),response=await f.post({...input,stream});
  const value=stream?events(await response.text()).at(-1):await response.json(),body=stream?value.response:value;
  if(stream)expect(value.type).toBe('response.incomplete');expect(body.status).toBe('incomplete');expect(body.completed_at).toBeNull();expect(body.incomplete_details).toEqual({reason:'max_output_tokens'});expect(body.output[0].status).toBe('incomplete');
});
it.each(['context-limit','unknown'])('does not fabricate terminal success or output budget for %s',async reason=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(preview(request));controls.onDelta({threadId:request.threadId,attemptId:request.attemptId,sequence:0,text:'partial'});return result(request,'partial',reason);}}});
  const rows=events(await(await f.post({...input,stream:true})).text());expect(rows.at(-1)).toMatchObject({type:'error',code:'server_error',param:null});
  expect(rows.some(r=>['response.completed','response.incomplete'].includes(r.type))).toBe(false);
  expect((await f.post()).status).toBe(502);
});
it.each(['','no-delta'])('handles complete output without callbacks including empty text %j',async content=>{
  const f=await boot({participant:{generate:async(request,controls)=>{await controls.requestApproval(preview(request));return result(request,content);}}}),rows=events(await(await f.post({...input,stream:true})).text());
  expect(rows.at(-1).type).toBe('response.completed');expect(rows.at(-1).response.output[0].content[0].text).toBe(content);
});
it('HTTP Responses reaches actual automatic requester and disclosure denial dispatches zero numerical stages',async()=>{
  const mesh=await automaticOrderedMesh();owners.push(()=>mesh.close());await mesh.prepare();await vi.waitFor(()=>expect(mesh.select(5,0)).toBeTruthy());
  const f=await boot({participant:mesh.meshes[5]}),body={model:mesh.model.id,input:tasks[0].prompt,store:false,stream:true};
  f.authorize.mockImplementation(async({action})=>action==='chat.execute');expect((await f.post(body)).status).toBe(403);
  expect(mesh.states.filter(row=>row.resident).every(row=>row.resident.executeStage.mock.calls.length===0)).toBe(true);
  f.authorize.mockResolvedValue(true);const rows=events(await(await f.post(body)).text());expect(rows.at(-1).response.output[0].content[0].text).toBe(tasks[0].chunks.join(''));
  expect(mesh.loads[5]).not.toHaveBeenCalled();expect(mesh.states[0].resident.executeStage).toHaveBeenCalledTimes(3);expect(mesh.states[1].resident.executeStage).toHaveBeenCalledTimes(3);expect(mesh.states[2].resident.executeStage).toHaveBeenCalledTimes(3);
  expect(mesh.states.every(row=>row.attempts.size===0)).toBe(true);
});
it('shares admission between protocols; disconnect and adapter close keep unsettled work charged without closing borrowed requester',async()=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let count=0;const signals=[],close=vi.fn();
  const f=await boot({participant:{close,generate:async(request,{signal})=>{signals.push(signal);if(++count===2)entered.resolve();await release.promise;throw Error('unknown cleanup');}}});
  const controller=new AbortController(),first=f.post(input,{signal:controller.signal});first.catch(()=>{});
  const second=fetch(f.url.replace('/responses','/chat/completions'),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer local-token'},body:JSON.stringify({model:model.id,messages:[{role:'user',content:'x'}]})});
  await entered.promise;expect((await f.post()).status).toBe(429);controller.abort();await expect(first).rejects.toThrow();await vi.waitFor(()=>expect(signals[0].aborted).toBe(true));
  expect(f.api.getState().active).toBe(1);expect(f.chat.getState().active).toBe(1);
  let closed=false;const stopping=f.api.close().then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);expect(signals[1].aborted).toBe(false);
  release.resolve();await Promise.all([second,stopping]);expect(f.api.getState().active).toBe(0);expect(close).not.toHaveBeenCalled();
});
it.each(['authenticate','authorize'])('abort while %s awaits cannot execute late approval',async port=>{
  const entered=Promise.withResolvers(),release=Promise.withResolvers();let signal;
  const f=await boot({[port]:async(...args)=>{signal=port==='authenticate'?args[1].signal:args[0].signal;entered.resolve();await release.promise;return port==='authenticate'?{subject:'late'}:true;}});
  const controller=new AbortController(),request=f.post(input,{signal:controller.signal});request.catch(()=>{});await entered.promise;controller.abort();await expect(request).rejects.toThrow();
  await vi.waitFor(()=>expect(signal.aborted).toBe(true));expect(f.api.getState().active).toBe(1);release.resolve();await vi.waitFor(()=>expect(f.api.getState().active).toBe(0));expect(f.generate).not.toHaveBeenCalled();
});
it('authentication failure, unsupported input and wrong output identity never become a successful response',async()=>{
  const f=await boot();expect((await f.post(input,{headers:{'content-type':'application/json'}})).status).toBe(401);
  expect((await f.post({...input,tools:[]})).status).toBe(400);expect(f.generate).not.toHaveBeenCalled();
  f.participant.generate=async request=>({...result(request),attemptId:'different'});expect((await f.post()).status).toBe(502);
});
