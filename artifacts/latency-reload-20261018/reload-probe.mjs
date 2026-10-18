import {gunzipSync} from 'node:zlib';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {readChatWorkspace} from '../../tests/fixtures/chat-workspace-history.js';
const browser=await chromium.launch({channel:'chrome',headless:true});const c=await browser.newContext();const p=await c.newPage();
const receipt={at:new Date().toISOString(),cycles:[],pageErrors:[],failures:[],passed:false};
p.on('pageerror',e=>receipt.pageErrors.push(e.message));p.on('requestfailed',r=>receipt.failures.push({url:r.url(),error:r.failure()}));
try{
 await p.goto('https://replo.id',{waitUntil:'domcontentloaded'});await p.locator('[data-chat-workspace]').waitFor({timeout:45000});
 const saved=JSON.parse(gunzipSync(await fs.readFile(new URL('./journey.json.gz',import.meta.url)))).workspace;
 assert.ok(saved.selectedId);receipt.selectedId=saved.selectedId;receipt.modelId=saved.threads.find(t=>t.id===saved.selectedId).model.id;
 await p.evaluate(async workspace=>{const req=indexedDB.open('reploid-requester-history');const db=await new Promise((r,j)=>{req.onsuccess=()=>r(req.result);req.onerror=()=>j(req.error);});const tx=db.transaction('conversations','readwrite');const store=tx.objectStore('conversations');const read=store.get('workspace');read.onsuccess=()=>{const row=read.result;row.workspace=workspace;store.put(row,'workspace');};await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=()=>j(tx.error);});db.close();},saved);
 for(let i=0;i<4;i++){
  const started=Date.now();await p.reload({waitUntil:'domcontentloaded'});await p.locator('[data-chat-workspace]').waitFor({timeout:45000});
  const state=await readChatWorkspace(p);const row={ms:Date.now()-started,selectedId:state.selectedId,url:p.url(),resources:await p.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('app.bundle')).map(r=>({duration:r.duration,transferSize:r.transferSize})))};
  receipt.cycles.push(row);assert.equal(state.selectedId,saved.selectedId);assert.deepEqual(state.threads,saved.threads);
  assert.match(await p.locator('[data-current-model]').innerText(),/2B/);console.log(row);
 }
 receipt.passed=true;
}catch(e){receipt.error=e.stack;throw e;}finally{await fs.writeFile(new URL('./reload-probe.json',import.meta.url),JSON.stringify(receipt,null,2));await c.close();await browser.close();}
