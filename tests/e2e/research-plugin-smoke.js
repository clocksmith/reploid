import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const out=process.env.REPLOID_UI_OUTPUT || 'artifacts/plugin-imitation-ui';await fs.mkdir(out,{recursive:true});
const layers=JSON.parse(await fs.readFile('self/styles/poolday/layers.json','utf8'));
const styles=['/styles/rd.css',...[layers.tokens,...layers.primitives,...layers.compositions].map(p=>'/styles/poolday/'+p)];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/plugin-fixture',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html class="pool-page"><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles.map(s=>`<link rel="stylesheet" href="${s}">`).join('')}</head><body><main class="pool-home" data-pool-route-id="experiments"><div class="pool-route-content" id="fixture"></div></main></body></html>`}));
try {
 await page.goto((process.env.REPLOID_UI_BASE_URL || 'http://127.0.0.1:8000') + '/plugin-fixture');
 await page.evaluate(async()=>{
  const ui=await import('/ui/pool-home/research-plugins.js');
  const models=[{id:'qwen-3-5-0-8b-q4k-ehaf16',name:'Qwen 3.5 0.8B',identity:'fixture-small',provider:'doppler'},{id:'qwen3-8-27b-text-q4k-ehaf16',name:'Qwen 3.8 27B',identity:'fixture-large',provider:'doppler'}];
  const host={chat:{getState:()=>({models}),subscribe:()=>()=>{}},swarm:{getState:()=>({consumer:{peers:models.map(m=>({model:m.id,modelIdentity:m.identity,peerId:m.id,role:'provider',readiness:'ready',availableSlots:1}))}}),generate:async(messages,c)=>{
   window.__calls++;if(window.__wait)await new Promise((resolve,reject)=>c.signal.addEventListener('abort',()=>reject(c.signal.reason),{once:true}));
   const preview={providerId:c.modelId,modelId:c.modelId,modelIdentity:c.modelIdentity,adapterIdentities:[]};
   if(!await c.approve(preview))throw Error('Fixture permission rejected');await c.record({stage:'approved',preview});
   return {content:'13',model:c.modelId,modelIdentity:c.modelIdentity,provider:'doppler',peerId:c.modelId};
  }}};
  window.__calls=0;window.__wait=true;const root=document.querySelector('#fixture');root.innerHTML=ui.renderResearchPlugins();window.__dispose=ui.bindResearchPlugins(root,host);
 });
 const capture=async state=>{for(const theme of ['light','dark'])for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.evaluate(theme=>{document.documentElement.dataset.reploidTheme=theme;document.querySelector('.pool-home').dataset.poolTheme=theme},theme);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+state+' '+name);
  await page.waitForTimeout(150);await page.screenshot({path:`${out}/${state}-${theme}-${name}.png`,fullPage:true});
 }};
 await page.locator('[data-study-start]').waitFor();await capture('setup');await page.locator('[data-study-start]').click();await page.waitForFunction(()=>__calls===1);await capture('preparing');
 await page.locator('[data-study-stop]').click();await page.getByRole('heading',{name:'Study cancelled'}).waitFor();await capture('cancelled');
 await page.evaluate(()=>{__wait=false});await page.locator('[data-study-new]').click();await page.locator('[data-study-start]').click();await page.locator('[data-study-judge]').waitFor();await capture('blind');
 if(await page.evaluate(()=>__calls)!==19)throw Error('Unexpected call count');
 await page.locator('[data-study-followup]').click();
 for(let i=0;i<4;i++){await page.locator('[name=judgment][value=unsure]').check();await page.locator('[data-study-judge]').click();await page.waitForTimeout(50)}
 await page.getByRole('heading',{name:'Study complete'}).waitFor();await capture('complete');
 await page.locator('[data-study-new]').click();await page.locator('[data-study-restore]').click();await page.getByRole('heading',{name:'Study complete'}).waitFor();
 const files=['self/host/research-plugins.js','self/ui/pool-home/research-plugins.js','self/plugins/model-imitation/plugin.js','self/vendor/reploid/plugins/session.js','self/ui/pool-home/index.js','self/ui/pool-home/shell-view.js','self/ui/pool-home/constants.js'];
 const base=process.cwd();
 const snapshot=Object.fromEntries(await Promise.all(files.map(async f=>['/'+f.replace('self/',''),await fs.readFile(base+'/'+f,'utf8')])));
 const verification=await page.evaluate(snapshot=>new Promise((resolve,reject)=>{const w=new Worker('/core/verification-worker.js');const timeout=setTimeout(()=>{w.terminate();reject(Error('Verification timed out'))},20000);w.onmessage=e=>{clearTimeout(timeout);w.terminate();resolve(e.data)};w.postMessage({type:'VERIFY',snapshot})}),snapshot);
 await fs.writeFile(out+'/verification.json',JSON.stringify(verification,null,2));
 console.log('Verification Worker:', verification.passed ? 'passed' : 'failed');if(!verification.passed)throw Error('Verification failed');
 await fs.writeFile(out+'/result.json',JSON.stringify({scope:'Browser UI with injected model responses; no research or physical inference result',screenshots:20,errors,passed:errors.length===0},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 console.log('Browser UI passed');
}finally{await browser.close()}
