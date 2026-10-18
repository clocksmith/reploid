import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const snapshot={};
for(const name of ['host/product-session.js','ui/pool-home/index.js','config/doppler-metadata-contract.js'])snapshot['/'+name]=await fs.readFile('self/'+name,'utf8');
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage();await page.goto('http://localhost:8148/favicon.svg');
 const result=await page.evaluate(snapshot=>new Promise((resolve,reject)=>{
  const worker=new Worker('/core/verification-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(Error('Verification timed out'));},10000);
  worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data);};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};
  worker.postMessage({type:'VERIFY',snapshot});
 }),snapshot);
 await fs.writeFile(new URL('./verification-worker.json', import.meta.url),JSON.stringify(result,null,2));
 console.log({passed:result.passed,errors:result.errors,warnings:result.warnings.length,files:result.details.filesAnalyzed});assert.ok(result.passed);
}finally{await browser.close();}
