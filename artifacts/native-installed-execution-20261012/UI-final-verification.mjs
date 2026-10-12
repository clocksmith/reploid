import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const path=new URL('./UI-draft-materialization.json',import.meta.url);
const prior=JSON.parse(await readFile(path,'utf8'));
expect(prior.error).toContain('UI-controller.mjs:65:50');
expect(prior.threads.first.messages.at(-1).content).toBe('$36');
expect(prior.threads.followup.messages.at(-1).content).toBe('$48');
expect(prior.threads.survivor.messages.at(-1).content).toBe('$60');
expect(prior.threads.reused.messages.at(-1).content).toBe('$72');
expect(prior.beforeCancel.cancelled.attempts.at(-1).status).toBe('executing');
expect(prior.beforeCancel.survivor.attempts.at(-1).status).toBe('executing');
expect(prior.threads.cancelled.attempts.at(-1).status).toBe('cancelled');
const browser=await chromium.connectOverCDP('http://127.0.0.1:54307');
const page=browser.contexts()[0].pages().find(p=>p.url().startsWith('http://localhost:8000/'));
const observed=await page.evaluate(async()=>{
 const storage=[];const walk=async(dir,prefix='')=>{for await(const[name,entry]of dir.entries()){const path=prefix+name;if(entry.kind==='directory')await walk(entry,path+'/');else storage.push({path,bytes:(await entry.getFile()).size});}};
 await walk(await navigator.storage.getDirectory());
 return{threads:JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')).threads,drafts:JSON.parse(localStorage.getItem('reploid.chat-workspace:v1:drafts')||'{}'),storage};
});
const oldIds=new Set(prior.before.map(t=>t.id));
expect(observed.threads.filter(t=>oldIds.has(t.id))).toEqual(prior.before);
const oldDrafts=JSON.parse(prior.draftsBefore||'{}');
const materializedEmptyDrafts=[];
for(const id of oldIds){
 if(oldDrafts[id]!==undefined)expect(observed.drafts[id]).toEqual(oldDrafts[id]);
 else if(observed.drafts[id]!==undefined){expect(observed.drafts[id]).toEqual({text:'',files:[]});materializedEmptyDrafts.push(id);}
}
for(const[id,thread]of Object.entries(prior.threads))if(id!=='first')expect(observed.threads.find(t=>t.id===thread.id)).toEqual(thread);
expect(prior.weightRequests).toEqual([]);
expect(observed.storage.reduce((sum,file)=>sum+file.bytes,0)).toBeLessThanOrEqual(4096);
expect(observed.storage.filter(f=>/(safetensors|gguf|\.bin$|weight|shard|piece)/i.test(f.path))).toEqual([]);
const receipt={schema:'reploid.native-installed-ui-verification/v1',ok:true,at:new Date().toISOString(),priorReceipt:'UI-draft-materialization.json',scope:'Postconditions checked after retained controller draft-shape assertion failure; no repeated inference or rewritten observation',answers:['$36','$48','$60','$72'],bothExecutingBeforeCancellation:true,cancelledThread:prior.threads.cancelled.id,survivorThread:prior.threads.survivor.id,materializedEmptyDrafts,requesterStorage:observed.storage,oldThreadsRetained:oldIds.size,oldDraftsRetained:true};
await writeFile(new URL('./UI-final-verification.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));process.exit(0);
