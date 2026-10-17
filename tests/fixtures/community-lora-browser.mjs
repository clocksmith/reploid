import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = [
  "packages/reploid/src/mesh/partitions/partition-network.js",
  "packages/reploid/src/transport/swarm.js",
  "self/config/doppler-local-models.js",
  "self/host/product-session.js",
  "self/host/work-swarm.js",
  "self/ui/pool-home/index.js",
  "self/ui/pool-home/work.js",
  "packages/reploid/src/training/index.js",
  "packages/reploid/src/training/network.js",
  "packages/reploid/src/training/session.js",
  "self/host/lora-training-executor.js",
  "self/host/lora-training-worker.js",
  "self/host/lora-training.js",
  "self/ui/pool-home/lora-training.js"
];
const sources=await Promise.all(files.map(async name=>[name,await fs.readFile(path.join(root,name),'utf8')]));
const server=http.createServer(async(req,res)=>{
 const name=new URL(req.url,'http://localhost').pathname;
 try {
  const file=path.resolve(root,'self','.'+(name==='/'||name==='/improve'?'/index.html':name));
  if(!file.startsWith(root+'/self/'))throw Error('path');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');
  res.end(await fs.readFile(file));
 }catch {res.statusCode=404;res.end('Missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({channel:'chrome',headless:true});
const out=path.join(root,'artifacts/community-lora-20261017');await fs.mkdir(out,{recursive:true});
try {
 const page=await browser.newPage();
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());
 await page.goto(url+'/improve');
 const result=await page.evaluate(snapshot=>new Promise((resolve,reject)=>{
  const worker=new Worker('/core/verification-worker.js');
  const timer=setTimeout(()=>{worker.terminate();reject(Error('Verification timeout'));},30000);
  worker.onmessage=e=>{clearTimeout(timer);worker.terminate();resolve(e.data);};
  worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};
  worker.postMessage({type:'VERIFY',snapshot});
 }),Object.fromEntries(sources.map(([name,source])=>['/'+name.replace(/^self\//,''),source])));
 await fs.writeFile(path.join(out,'verification.json'),JSON.stringify({at:new Date().toISOString(),sources:sources.map(([name,source])=>({path:name,hash:'sha256:'+createHash('sha256').update(source).digest('hex')})),result},null,2)+'\n');
 console.log(JSON.stringify({passed:result.passed,errors:result.errors,warnings:result.warnings?.length}));
 if(!result.passed)throw Error('Verification failed');
 await page.locator('[data-lora-panel]').waitFor({timeout:20000});
 await page.locator('[data-lora-panel] > summary').click();
 await page.locator('[data-lora-local]').click();
 await page.locator('[data-lora-error]').filter({hasText:'Choose training samples first'}).waitFor();
 const views=[];
 for(const width of [390,1280]) {
  await page.setViewportSize({width,height:900});
  await page.locator('[data-lora-stop]').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,`training-${width}.png`)});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  views.push({width,overflow,panels:await page.locator('[data-lora-panel]').count()});if(overflow)throw Error('Overflow');
 }
 await fs.writeFile(path.join(out,'browser.json'),JSON.stringify({at:new Date().toISOString(),route:'/improve',views,emptyInputRejected:true,scope:'Real Chrome, shipped product view and Verification Worker; no browser GPU training or deployment claim'},null,2)+'\n');
 console.log(JSON.stringify({views}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
