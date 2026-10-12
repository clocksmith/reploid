import {chromium,expect} from '/Users/xyz/deco/reploid/node_modules/@playwright/test/index.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const r=JSON.parse(await readFile('/Users/xyz/deco/reploid/artifacts/live-conversation-20261012/contribution-stop-readiness-failure.json'));
const b=await chromium.connectOverCDP('http://127.0.0.1:54307'),p=b.contexts()[0].pages()[0],id=r.after.id;
const thread=()=>p.evaluate(id=>JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')).threads.find(t=>t.id===id),id);
r.explicitRetryAt=new Date().toISOString();r.failedImmediateRetry=r.error;delete r.error;
try{
 await expect(p.locator('[data-model-control]')).toHaveAttribute('data-activity','ready',{timeout:120000});await p.locator('[data-retry-attempt]').click();await p.locator('[data-approval-consent]').waitFor();r.retryApproval=JSON.parse(await p.locator('[data-permission-technical]').textContent());await p.locator('[data-approval-consent]').check();await p.locator('[data-approval-send]').click();
 const attempt=(await thread()).attempts.at(-1).id;
 await expect.poll(async()=>{const a=(await thread()).attempts.find(a=>a.id===attempt);if(a.status==='failed')throw Error(a.error);return a.status},{timeout:180000}).toBe('completed');
 r.final=await thread();expect(r.final.messages.slice(0,r.interrupted.messages.length)).toEqual(r.interrupted.messages);r.ok=true;
}catch(error){r.ok=false;r.error=error.stack;r.final=await thread();}
r.finishedAt=new Date().toISOString();await writeFile('/Users/xyz/deco/reploid/artifacts/live-conversation-20261012/contribution-stop-retry.json',JSON.stringify(r,null,2));console.log(JSON.stringify({ok:r.ok,error:r.error,answer:r.final?.messages.at(-1)?.content}));process.exit(r.ok?0:1);
