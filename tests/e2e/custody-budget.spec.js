import { test, expect } from '@playwright/test';
const modulePath = '/infrastructure/custody-supply-budget.js';
async function initialize(page, name, allowInitialize=true) {
 await page.goto('/config/chat-files.json');
 return page.evaluate(async ({modulePath,name,allowInitialize}) => {
  const {openBrowserSupplyBudget}=await import(modulePath);
  window.budget=await openBrowserSupplyBudget({name,maxBytes:10,allowInitialize});
  return window.budget.getState();
 }, {modulePath,name,allowInitialize});
}
test('strict durable reservations survive reload and cannot be renewed by another tab',async({page,context})=>{
 const name='custody-test-'+crypto.randomUUID();await initialize(page,name);
 await page.evaluate(()=>window.budget.reserve(7));await page.reload();
 expect((await initialize(page,name)).reservedBytes).toBe(7);
 const other=await context.newPage();await initialize(other,name);
 const reserve=p=>p.evaluate(async()=>{try{return await window.budget.reserve(2);}catch(e){return {error:e.code};}});
 const outcomes=await Promise.all([reserve(page),reserve(other)]);
 expect(outcomes.filter(x=>x.reservedBytes===9)).toHaveLength(1);
 expect(outcomes.filter(x=>x.error==='CUSTODY_BUDGET_LIMIT')).toHaveLength(1);
 await other.close();await page.reload();expect((await initialize(page,name)).reservedBytes).toBe(9);
});
test('corrupt and missing existing browser ledgers fail closed',async({page})=>{
 for(const mode of ['corrupt','missing']){
  const name='custody-test-'+crypto.randomUUID();await initialize(page,name);
  const code=await page.evaluate(async({name,mode,modulePath})=>{
   window.budget.close();
   const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(name,1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('allowance','readwrite',{durability:'strict'});const store=tx.objectStore('allowance');
    if(mode==='missing')store.delete('supply');else store.put({schema:'invalid',reservedBytes:-1},'supply');
    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
   const {openBrowserSupplyBudget}=await import(modulePath);
   try{await openBrowserSupplyBudget({name,maxBytes:10,allowInitialize:true});return 'unexpected success';}catch(e){return e.code;}
  },{name,mode,modulePath});
  expect(code).toBe('CUSTODY_BUDGET_'+(mode==='corrupt'?'CORRUPT':'MISSING'));
 }
});
test('legacy caches cannot silently initialize allowance and closed persistence rejects reservations',async({page})=>{
 await page.goto('/config/chat-files.json');
 const result=await page.evaluate(async(modulePath)=>{
  const {openBrowserSupplyBudget}=await import(modulePath);let missing;
  try{await openBrowserSupplyBudget({name:crypto.randomUUID(),maxBytes:10,allowInitialize:false});}catch(e){missing=e.code;}
  const budget=await openBrowserSupplyBudget({name:crypto.randomUUID(),maxBytes:10,allowInitialize:true});budget.close();
  let closed;try{await budget.reserve(1);}catch(e){closed=e.code;}return {missing,closed};
 },modulePath);
 expect(result).toEqual({missing:'CUSTODY_BUDGET_MISSING',closed:'CUSTODY_BUDGET_STORAGE'});
});
test('an aborted real IndexedDB reservation is unconfirmed and cannot authorize supply',async({page})=>{
 const name='custody-test-'+crypto.randomUUID();await initialize(page,name);
 const result=await page.evaluate(async()=>{
  const original=IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction=function(...args){const tx=original.apply(this,args);queueMicrotask(()=>tx.abort());return tx;};
  let code;try{await window.budget.reserve(5);}catch(e){code=e.code;}finally{IDBDatabase.prototype.transaction=original;}
  return {code,state:window.budget.getState()};
 });
 expect(result.code).toBe('CUSTODY_BUDGET_STORAGE');expect(result.state.reservedBytes).toBe(0);
 await page.reload();expect((await initialize(page,name)).reservedBytes).toBe(0);
});

test('acquisition allowance is independent, immutable, durable and serialized across tabs', async ({page,context}) => {
 const name='download-'+crypto.randomUUID();
 const open=async p=>{await p.goto('/config/chat-files.json');return p.evaluate(async({name,modulePath})=>{
  const {openBrowserAcquisitionBudget}=await import(modulePath);
  window.budget=await openBrowserAcquisitionBudget({name,maxBytes:10,allowInitialize:true});return window.budget.getState();
 },{name,modulePath});};
 expect((await open(page)).schema).toBe('reploid.custody-acquisition-budget/v1');
 await page.evaluate(()=>window.budget.reserve(7));await page.reload();expect((await open(page)).reservedBytes).toBe(7);
 const other=await context.newPage();await open(other);
 const outcomes=await Promise.all([page,other].map(p=>p.evaluate(async()=>{try{return await window.budget.reserve(2);}catch(e){return {error:e.code};}})));
 expect(outcomes.filter(x=>x.reservedBytes===9)).toHaveLength(1);
 expect(outcomes.filter(x=>x.error==='CUSTODY_BUDGET_LIMIT')).toHaveLength(1);
 const code=await page.evaluate(async({name,modulePath})=>{
  const {openBrowserAcquisitionBudget}=await import(modulePath);
  try{await openBrowserAcquisitionBudget({name,maxBytes:20,allowInitialize:true});}catch(e){return e.code;}
 },{name,modulePath});
 expect(code).toBe('CUSTODY_BUDGET_POLICY');await other.close();await page.reload();expect((await open(page)).reservedBytes).toBe(9);
});
