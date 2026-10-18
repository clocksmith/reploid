import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readChatWorkspace} from '../../tests/fixtures/chat-workspace-history.js';
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext(); const page=await context.newPage();page.setDefaultTimeout(60000);
const receipt={bundle:JSON.parse(await fs.readFile(new URL('../../self/config/browser-bundle-manifest.json',import.meta.url))).bundleHash,at:new Date().toISOString(),url:'https://replo.id',browser:browser.version(),observations:[],errors:[],weightRequests:[],passed:false};
page.on('requestfailed',r=>{(receipt.requestFailures??=[]).push({url:r.url(),failure:r.failure()});});
page.on('pageerror',e=>receipt.errors.push(e.message));
page.on('request',r=>{if(/shard_\d+\.bin|tokenizer\.json/.test(r.url()))receipt.weightRequests.push(r.url());});
const save=()=>fs.writeFile(new URL('./journey.json',import.meta.url),JSON.stringify(receipt,null,2));
async function send(prompt,search,pattern){
 await page.locator('[data-composer-send]').waitFor({state:'visible'});
 const toggle=page.locator('[data-search-toggle]');
 if((await toggle.getAttribute('aria-pressed')==='true')!==search)await toggle.click();
 const before=new Set((await readChatWorkspace(page)).threads.flatMap(t=>t.attempts.map(a=>a.id)));
 await page.locator('[data-composer-input]').fill(prompt); const start=Date.now();
 await page.locator('[data-composer-send]').click();
 let row={prompt,search,firstOutputMs:null}; receipt.observations.push(row);
 for(let i=0;i<450;i++){
  const w=await readChatWorkspace(page);
  const t=w?.threads.find(t=>t.attempts.some(a=>!before.has(a.id)));
  if(t){const a=t.attempts.find(a=>!before.has(a.id));const answer=t.messages.find(m=>m.id===a.responseId)?.content||'';
   row={...row,attempt:a,answer,elapsedMs:Date.now()-start}; if(answer&&row.firstOutputMs===null)row.firstOutputMs=Date.now()-start;
   receipt.observations[receipt.observations.length-1]=row;
   if(['completed','failed','cancelled','interrupted'].includes(a.status))break;
  }
  await page.waitForTimeout(200);
 }
 await save();console.log(JSON.stringify({prompt,status:row.attempt?.status,answer:row.answer,elapsedMs:row.elapsedMs,provider:row.attempt?.searchPermission?.searchProvider,error:row.attempt?.error}));
 assert.equal(row.attempt.execution?.modelId,'qwen-3-5-2b-q4k-ehaf16');
 assert.equal(row.attempt.execution?.modelIdentity,'sha256:83e5a01a21e234d238ea3ed5b0b234cc52781ddfce51861abd0fdf0ae3199028');
 if(receipt.observations.length>1)assert.equal(row.attempt.threadId,receipt.observations[0].attempt.threadId);
 assert.equal(row.attempt.status,'completed');assert.match(row.answer,pattern);
 if(search){assert.equal(row.attempt.searchPermission.searchProvider,'contributor-google-browser');assert.match(row.answer,/\[\d+\]/);}else assert.equal(row.attempt.retrieval,undefined);
 assert.equal(await page.locator('[data-search-permission], [data-remote-permission]').count(),0);
}
try{
 await page.goto('https://replo.id',{waitUntil:'domcontentloaded'});await page.locator('[data-chat-workspace]').waitFor({timeout:45000});
 await page.locator('[data-open-model]').click();await page.locator('.chat-model-choices input[value="qwen-3-5-2b-q4k-ehaf16"]').filter({visible:true}).check();await page.locator('[data-close-inspector]').click();
 await page.locator('[data-inspector-section="settings"]').click();
 const remote=page.locator('[data-remote-answers-toggle]');
 console.log('remote',await remote.getAttribute('aria-checked'));
 if(await remote.getAttribute('aria-checked')!=='true')await remote.click();
 await page.locator('[data-close-inspector]').click();
 await page.waitForTimeout(12000);
 console.log((await page.locator('body').innerText()).slice(-3000));
 await send('What year was the Eiffel Tower completed? Cite a source.',true,/1889/);
 await send('Which city is it in? Answer with the city only.',false,/Paris/i);
 const before=await readChatWorkspace(page);await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-chat-workspace]').waitFor({timeout:45000});
 receipt.historyPreserved=JSON.stringify((await readChatWorkspace(page)).threads)===JSON.stringify(before.threads);assert.ok(receipt.historyPreserved);assert.equal((await readChatWorkspace(page)).selectedId,before.selectedId);assert.ok(before.selectedId);
 receipt.selectedThreadPreserved=true;
 await send('Who wrote Pride and Prejudice? Cite a source.',true,/Jane Austen/i);
 await send('Which two Nobel Prizes did Marie Curie win? Cite a source.',true,/physics[\s\S]*chemistry|chemistry[\s\S]*physics/i);
 receipt.reloads=[];
 for(let i=0;i<3;i++){const w=await readChatWorkspace(page);const start=Date.now();await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-chat-workspace]').waitFor({timeout:45000});const after=await readChatWorkspace(page);assert.equal(after.selectedId,w.selectedId);assert.deepEqual(after.threads,w.threads);receipt.reloads.push({elapsedMs:Date.now()-start,url:page.url(),resources:await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('app.bundle')).map(r=>({duration:r.duration,transferSize:r.transferSize})))});}
 assert.equal(receipt.weightRequests.length,0);assert.equal(receipt.errors.length,0);receipt.passed=true;
}catch(e){receipt.failure=e.stack;receipt.body=(await page.locator('body').innerText()).slice(-6000);receipt.workspace=await readChatWorkspace(page);await page.screenshot({path:new URL('./live-browser-search-failure.png',import.meta.url).pathname});throw e;}finally{await save();await context.close();await browser.close();receipt.requesterCleanup='close-completed';await save();}
