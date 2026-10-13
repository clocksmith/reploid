import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = 'artifacts/single-chat-rail-20261013/deployment/';
const expected='sha256:9fd73d06d9f1b16b2f6d6b4a94d5506a71c840a09c41a9f52d9138e5499dd9bd';
const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
const rows=[];
try {
 for(const width of [1440,900,390,320]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  await page.goto('https://replo.id',{waitUntil:'networkidle'});
  await page.locator('[data-chat-workspace]').waitFor();
  const bundle=await page.evaluate(async()=> (await(await fetch('/config/browser-bundle-manifest.json',{cache:'no-store'})).json()).bundleHash);
  assert.equal(bundle,expected);
  const input=page.locator('[data-composer-input]');
  await input.fill('A draft preserved while opening the panels.');
  for(const state of ['collapsed','threads','network','closed']) {
   if(state==='threads')await page.locator('[data-toggle-thread-rail]').click();
   if(state==='network')await page.locator('[data-toggle-inspector]').click();
   if(state==='closed')await page.locator('[data-close-inspector]').click();
   await page.waitForTimeout(350);
   const result=await page.evaluate(()=>{
    const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();
    const selectors=['[data-toggle-thread-rail]','[data-new-thread]','[data-open-model]','[data-toggle-inspector]'];
    return {stream:box('[data-message-stream]'),composer:box('[data-composer-area]'),area:box('[data-conversation-area]'),rail:box('[data-thread-sidebar]'),controls:selectors.map(s=>{const n=document.querySelector(s),b=n.getBoundingClientRect(),i=n.querySelector('svg,.pool-power-tower').getBoundingClientRect();return {selector:s,box:b.toJSON(),dx:i.x+i.width/2-b.x-b.width/2,dy:i.y+i.height/2-b.y-b.height/2,visible:n.checkVisibility(),inRail:!!n.closest('[data-chat-rail-toolbar]')};}),logos:[...document.querySelectorAll('.pool-power-tower')].filter(n=>n.checkVisibility()).length,threads:document.querySelector('[data-thread-panel]').checkVisibility(),network:document.querySelector('[data-contextual-inspector]').checkVisibility(),overflow:document.documentElement.scrollWidth-innerWidth};
   });
   assert.equal(result.logos,1);assert(result.controls.every(c=>c.visible&&c.inRail&&c.box.width===44&&c.box.height===44&&Math.abs(c.dx)<=.5&&Math.abs(c.dy)<=.5));
   assert(result.controls.every(c=>c.box.x===result.controls[0].box.x));
   assert(Math.abs(result.stream.x-result.composer.x)<=1);assert(Math.abs(result.stream.width-result.composer.width)<=1);
   assert(Math.abs(result.composer.x+result.composer.width/2-result.area.x-result.area.width/2)<=1);
   if(width>760)assert(result.composer.x>=result.rail.right+8);
   assert(result.overflow<=1);assert.equal(result.threads,state==='threads');assert.equal(result.network,state==='network');
   assert.equal(await input.inputValue(),'A draft preserved while opening the panels.');
   rows.push({width,state,bundle,...result});
   if(state==='collapsed'||state==='network')await page.screenshot({path:out+`live-${width}-${state}.png`});
  }
  await page.locator('[data-toggle-inspector]').focus();await page.keyboard.press('Enter');await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-contextual-inspector]').isVisible(),false);
  await page.locator('[data-toggle-inspector]').click();await page.locator('[data-new-thread]').click();
  assert.equal(await page.locator('[data-contextual-inspector]').isVisible(),false);
  assert(await input.evaluate(n=>n===document.activeElement));
  await page.close();
 }
 await writeFile(out+'live.json',JSON.stringify({scope:'Fresh public UI geometry, keyboard, New chat and preserved draft; no inference or physical keyboard claim',rows},null,2)+'\n');
}finally{await browser.close();}
