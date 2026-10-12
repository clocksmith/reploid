// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openNativeSupplyBudget } from '../../server/native-supply-budget.js';
const roots = [], handles = [];
afterEach(async () => { for (const handle of handles.splice(0)) handle.close(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive:true, force:true }))); });
async function root() { const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'custody-budget-')); roots.push(directory); return directory; }
async function open(directory, maxBytes=10) { const handle = await openNativeSupplyBudget({ directory,maxBytes }); handles.push(handle); return handle; }
it('preserves charges across close and reopen without renewing failed transfers', async () => {
 const directory = await root(), first = await open(directory);
 await first.reserve(7); first.close();
 const next = await open(directory); expect(next.getState().reservedBytes).toBe(7);
 await expect(next.reserve(4)).rejects.toMatchObject({code:'CUSTODY_BUDGET_LIMIT'});
 await next.reserve(3); expect(next.getState().reservedBytes).toBe(10);
 await expect(open(directory,20)).rejects.toMatchObject({code:'CUSTODY_BUDGET_POLICY'});
});
it('serializes separate database owners without exceeding the allowance', async () => {
 const directory=await root(), a=await open(directory), b=await open(directory);
 const outcomes=await Promise.allSettled([a.reserve(6),b.reserve(6)]);
 expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 expect(outcomes.find(x=>x.status==='rejected').reason.code).toBe('CUSTODY_BUDGET_LIMIT');
 expect((await open(directory)).getState().reservedBytes).toBe(6);
});
it('fails closed for legacy nonempty caches and deleted ledgers', async () => {
 const legacy=await root(); await fs.writeFile(path.join(legacy,'verified-piece'),'bytes');
 await expect(open(legacy)).rejects.toMatchObject({code:'CUSTODY_BUDGET_MISSING'});
 const directory=await root(); const first=await open(directory); await first.reserve(8);first.close();
 const db=new DatabaseSync(path.join(directory,'custody-budget.sqlite'));db.prepare('DELETE FROM allowance').run();db.close();
 await expect(open(directory)).rejects.toMatchObject({code:'CUSTODY_BUDGET_MISSING'});
});
it('distinguishes corrupted record and unavailable storage from exhaustion', async () => {
 const directory=await root();(await open(directory)).close();
 const db=new DatabaseSync(path.join(directory,'custody-budget.sqlite'));db.prepare('UPDATE allowance SET record=?').run('{');db.close();
 await expect(open(directory)).rejects.toMatchObject({code:'CUSTODY_BUDGET_CORRUPT'});
 const broken=await root();await fs.writeFile(path.join(broken,'custody-budget.sqlite'),'not sqlite');
 await expect(open(broken)).rejects.toMatchObject({code:'CUSTODY_BUDGET_STORAGE'});
});
it('does not serve reservations after its persistence owner closes', async () => {
 const budget=await open(await root());budget.close();
 await expect(budget.reserve(1)).rejects.toMatchObject({code:'CUSTODY_BUDGET_STORAGE'});
});
it('preserves a single allowance across competing processes and a later restart', async()=>{
 const {execFile}=await import('node:child_process'), {promisify}=await import('node:util');
 const directory=await root();(await open(directory)).close();
 const source=`import {openNativeSupplyBudget} from ${JSON.stringify(new URL('../../server/native-supply-budget.js',import.meta.url).href)};
 const b=await openNativeSupplyBudget({directory:process.argv[2],maxBytes:10});
 try{console.log(JSON.stringify(await b.reserve(6)));}catch(e){console.log(JSON.stringify({error:e.code}));}finally{b.close();}`;
 const script=path.join(await root(),'reserve.mjs');await fs.writeFile(script,source);
 const runs=await Promise.all([1,2].map(()=>promisify(execFile)(process.execPath,[script,directory])));
 const outcomes=runs.map(x=>JSON.parse(x.stdout));
 expect(outcomes.filter(x=>x.reservedBytes===6)).toHaveLength(1);
 expect(outcomes.filter(x=>x.error==='CUSTODY_BUDGET_LIMIT')).toHaveLength(1);
 expect((await open(directory)).getState().reservedBytes).toBe(6);
});
