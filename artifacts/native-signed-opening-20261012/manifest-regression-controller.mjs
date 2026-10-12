import {chromium,expect} from '/Users/xyz/deco/reploid/node_modules/@playwright/test/index.mjs';
import {writeFile} from 'node:fs/promises';
const b=await chromium.connectOverCDP('http://127.0.0.1:54307'),p=b.contexts()[0].pages()[0];
const threads=()=>p.evaluate(()=>JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')).threads);
const r={startedAt:new Date().toISOString(),revision:'e83049df'};let id;
try {
 await p.reload();r.before=(await threads()).map(t=>({id:t.id,messages:t.messages}));
 r.weights=[];p.on('request',q=>{if(/\.(safetensors|gguf|bin)(?:$|\?)/i.test(q.url()))r.weights.push(q.url());});
 await p.locator('[data-new-thread]').click();await expect(p.locator('[data-model-control]')).toHaveAttribute('data-activity','ready',{timeout:180000});
 await p.locator('[data-composer-input]').fill('Tickets cost $12 each. What do three tickets cost? Answer briefly.');await p.locator('[data-composer-send]').click();await p.locator('[data-approval-consent]').waitFor();r.approval=JSON.parse(await p.locator('[data-permission-technical]').textContent());await p.locator('[data-approval-consent]').check();await p.locator('[data-approval-remember]').check();await p.locator('[data-approval-send]').click();id=(await threads()).at(-1).id;
 const thread=async()=>(await threads()).find(t=>t.id===id);
 await expect.poll(async()=>{const a=(await thread()).attempts.at(-1);if(a.status==='failed')throw Error(a.error);return a.status},{timeout:180000}).toBe('completed');r.first=await thread();expect(r.first.messages.at(-1).content).toMatch(/\$?36/);
 await p.locator('[data-composer-input]').fill('And four tickets at that same price?');await p.locator('[data-composer-send]').click();await expect.poll(async()=>{const a=(await thread()).attempts.at(-1);if(a.status==='failed')throw Error(a.error);return a.status},{timeout:180000}).toBe('completed');r.final=await thread();expect(r.final.messages.at(-1).content).toMatch(/\$?48/);expect(r.weights).toEqual([]);
 r.after=(await threads()).filter(t=>r.before.some(old=>old.id===t.id)).map(t=>({id:t.id,messages:t.messages}));expect(r.after).toEqual(r.before);r.ok=true;
}catch(error){r.ok=false;r.error=error.stack;r.final=id?(await threads()).find(t=>t.id===id):null;}
r.finishedAt=new Date().toISOString();await writeFile('/Users/xyz/deco/reploid/artifacts/native-signed-opening-20261012/manifest-regression-physical.json',JSON.stringify(r,null,2));console.log(JSON.stringify({ok:r.ok,error:r.error,answer:r.final?.messages.at(-1)?.content,recipients:r.approval?.recipients}));process.exit(r.ok?0:1);
