import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:'chrome',headless:true});
const page = await browser.newPage();
const report = {startedAt:new Date().toISOString(),weightRequests:[],criteria:{survivorNumbers:Array.from({length:20},(_,i)=>i+1),bothExecutingBeforeStop:true}};
const threads = () => page.evaluate(()=>JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')||'{"threads":[]}').threads);
const active = ['queued','loading','executing','approval','cancelling'];
try {
 page.on('request',r=>{if(/\.(bin|gguf|safetensors)(?:$|\?)/i.test(r.url()))report.weightRequests.push(r.url());});
 await page.goto('https://replo.id/');
 await expect(page.locator('[data-model-control]')).toHaveAttribute('data-activity','ready',{timeout:120000});
 await page.locator('[data-toggle-thread-rail]').click();
 await page.locator('[data-composer-input]').fill('Count from 1 to 500 in order, one integer per line. No commentary.');
 await page.locator('[data-composer-send]').click();
 await expect.poll(async()=> (await threads()).at(-1)?.attempts.at(-1)?.status,{timeout:60000,intervals:[100]}).toBe('executing');
 const first = (await threads()).at(-1).id;
 await page.locator('[data-new-thread]').click();
 await page.locator('[data-composer-input]').fill('Count from 1 to 20 in order, one integer per line. No commentary.');
 await page.locator('[data-composer-send]').click();
 await expect.poll(async()=>{
  const rows=await threads();return rows.length===2 && rows.every(t=>t.attempts.at(-1)?.status==='executing');
 },{timeout:60000,intervals:[50]}).toBe(true);
 report.beforeStop=await threads(); const second=report.beforeStop.find(t=>t.id!==first).id;
 await page.locator(`[data-thread-item-id="${first}"]`).click();
 await page.locator('[data-composer-stop]').click();
 await expect.poll(async()=>(await threads()).find(t=>t.id===first).attempts.at(-1).status,{timeout:60000}).toBe('cancelled');
 await page.locator(`[data-thread-item-id="${second}"]`).click();
 await expect.poll(async()=>(await threads()).find(t=>t.id===second).attempts.at(-1).status,{timeout:180000}).toBe('completed');
 report.afterStop=await threads();
 const answer=report.afterStop.find(t=>t.id===second).messages.at(-1).content;
 expect((answer.match(/\d+/g)||[]).map(Number)).toEqual(report.criteria.survivorNumbers);
 await page.locator('[data-composer-input]').fill('Keep this unsent draft after reload.');
 await page.locator('[data-composer-input]').blur();
 report.draftsBeforeReload=await page.evaluate(()=>localStorage.getItem('reploid.chat-workspace:v1:drafts'));
 await page.reload();
 if(await page.locator('[data-toggle-thread-rail]').getAttribute('aria-expanded')!=='true')await page.locator('[data-toggle-thread-rail]').click();
 await page.locator(`[data-thread-item-id="${second}"]`).click();
 report.draftsAfterReload=await page.evaluate(()=>localStorage.getItem('reploid.chat-workspace:v1:drafts'));
 expect(JSON.parse(report.draftsAfterReload)[second]).toEqual(JSON.parse(report.draftsBeforeReload)[second]);
 await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this unsent draft after reload.');
 expect(await threads()).toEqual(report.afterStop);
 expect(report.weightRequests).toEqual([]);
 report.passed=true;
} catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;report.failedState=await threads().catch(()=>[]);}
finally {
 for(const thread of await threads().catch(()=>[])) if(active.includes(thread.attempts.at(-1)?.status)) {
  try {
   if(await page.locator('[data-toggle-thread-rail]').getAttribute('aria-expanded')!=='true')await page.locator('[data-toggle-thread-rail]').click();
   await page.locator(`[data-thread-item-id="${thread.id}"]`).click();await page.locator('[data-composer-stop]').click();
   await expect.poll(async()=>active.includes((await threads()).find(t=>t.id===thread.id).attempts.at(-1).status),{timeout:60000}).toBe(false);
  }catch(error){report.cleanupError=error.stack;report.passed=false;process.exitCode=1;}
 }
 report.finishedAt=new Date().toISOString();
 await writeFile(new URL('./concurrent-chat.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,error:report.error,cleanupError:report.cleanupError,weights:report.weightRequests}));
 await browser.close();
}
