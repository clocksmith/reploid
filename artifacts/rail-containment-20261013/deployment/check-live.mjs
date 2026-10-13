import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = 'artifacts/rail-containment-20261013/deployment/';
const browser = await chromium.launch({ headless:true, args:['--disable-gpu'] });
const rows=[];
try {
  for (const width of [1440,900,390,320]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    await page.goto('https://replo.id', {waitUntil:'networkidle'});
    await page.locator('[data-chat-workspace]').waitFor();
    const bundle=await page.evaluate(async()=> (await(await fetch('/config/browser-bundle-manifest.json',{cache:'no-store'})).json()).bundleHash);
    assert.equal(bundle,'sha256:975aa791c2a48c592fed62f1467549841a1e473990ffe8318e3bf1fd779fceda');
    const input=page.locator('[data-composer-input]');await input.fill('A draft that wraps when the available chat column becomes narrow.');
    for(const state of ['collapsed','left','both','right','closed']) {
      if(width<=760 && state==='both')continue;
      if(state==='left')await page.locator('[data-toggle-thread-rail]').click();
      if(state==='both')await page.locator('[data-toggle-inspector]').click();
      if(state==='right') {await page.locator('[data-toggle-thread-rail]').click();if(width<=760)await page.locator('[data-toggle-inspector]').click();}
      if(state==='closed')await page.locator('[data-toggle-inspector]').click();
      await page.waitForTimeout(350);
      const geometry=await page.evaluate(()=>Object.fromEntries(['[data-chat-transcript]','[data-message-stream]','[data-composer-area]','[data-thread-sidebar]','[data-network-rail]'].map(s=>[s,document.querySelector(s).getBoundingClientRect().toJSON()])));
      const transcript=geometry['[data-message-stream]'],composer=geometry['[data-composer-area]'];
      assert(Math.abs(transcript.x-composer.x)<1);assert(Math.abs(transcript.width-composer.width)<1);
      if(width>760){assert(composer.x>=geometry['[data-thread-sidebar]'].right);assert(composer.right<=geometry['[data-network-rail]'].left);}
      assert.equal(await input.inputValue(),'A draft that wraps when the available chat column becomes narrow.');
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      rows.push({width,state,bundle,geometry});
      if(state==='both'||state==='collapsed')await page.screenshot({path:out+`live-${width}-${state}.png`});
    }
    await page.close();
  }
  await writeFile(out+'live.json',JSON.stringify({scope:'Fresh public UI geometry and preserved draft during rail toggles; no inference, real-user upgrade or physical keyboard claim',rows},null,2)+'\n');
}finally{await browser.close();}
