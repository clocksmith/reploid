import {chromium,expect} from '/Users/xyz/deco/reploid/node_modules/@playwright/test/index.mjs';
import {writeFile} from 'node:fs/promises';
const b=await chromium.connectOverCDP('http://127.0.0.1:54307'),p=b.contexts()[0].pages()[0];
const [target]=await(await fetch('http://127.0.0.1:9229/json/list')).json();
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
const pending=new Map();let request=0;
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const x=pending.get(m.id);pending.delete(m.id);m.error?x.reject(m.error):x.resolve(m.result);}};
const onCompute=async expression=>{const result=await new Promise((resolve,reject)=>{const id=++request;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const threads=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')).threads);
let threadId;const thread=async()=>(await threads()).find(t=>t.id===threadId);
const r={startedAt:new Date().toISOString()};
try{
 await p.reload();await p.locator('[data-new-thread]').click();await expect(p.locator('[data-model-control]')).toHaveAttribute('data-activity','ready',{timeout:120000});
 await p.locator('[data-composer-input]').fill('Explain in three short sentences why an offline backup helps protect family photos.');await p.locator('[data-composer-send]').click();await p.locator('[data-approval-consent]').waitFor();
 r.approval=JSON.parse(await p.locator('[data-permission-technical]').textContent());await p.locator('[data-approval-consent]').check();await p.locator('[data-approval-send]').click();
 threadId=(await threads()).at(-1).id;
 await expect.poll(async()=>{const t=await thread();return t.messages.at(-1).content.length},{timeout:120000}).toBeGreaterThan(24);
 r.beforeStop=await thread();const priorAttempt=r.beforeStop.attempts.at(-1).id;
 r.stop=await onCompute(`(async()=>{const p=__diagnosticPage;await p.locator('[data-toggle-contribution]').click();await p.waitForFunction(()=>document.querySelector('[data-contrib-label]').textContent==='Not sharing'&&!document.querySelector('[data-toggle-contribution]').disabled);return {label:await p.locator('[data-contrib-label]').textContent(),error:await p.locator('[data-network-message]').textContent(),at:new Date().toISOString()};})()`);
 await expect.poll(async()=>(await thread()).attempts.find(a=>a.id===priorAttempt).status,{timeout:45000}).toMatch(/failed|cancelled|interrupted/);
 r.interrupted=await thread();
 r.restart=await onCompute(`(async()=>{const p=__diagnosticPage;await p.locator('[data-toggle-contribution]').click();return {label:await p.locator('[data-contrib-label]').textContent(),at:new Date().toISOString()};})()`);
 await expect(p.locator('[data-model-control]')).toHaveAttribute('data-activity','ready',{timeout:120000});await p.locator('[data-retry-attempt]').click();await p.locator('[data-approval-consent]').waitFor();await p.locator('[data-approval-consent]').check();await p.locator('[data-approval-send]').click();
 const retryId=(await thread()).attempts.at(-1).id;expect(retryId).not.toBe(priorAttempt);
 await expect.poll(async()=>{const a=(await thread()).attempts.find(a=>a.id===retryId);if(a.status==='failed')throw Error(a.error);return a.status},{timeout:180000}).toBe('completed');
 r.after=await thread();expect(r.after.messages.slice(0,r.interrupted.messages.length)).toEqual(r.interrupted.messages);r.ok=true;
}catch(error){r.ok=false;r.error=error.stack;r.after=threadId?await thread():null;}
r.finishedAt=new Date().toISOString();await writeFile('/Users/xyz/deco/reploid/artifacts/live-conversation-20261012/contribution-stop-retry.json',JSON.stringify(r,null,2));console.log(JSON.stringify({ok:r.ok,error:r.error,stop:r.stop,answer:r.after?.messages.at(-1)?.content}));ws.close();process.exit(r.ok?0:1);
