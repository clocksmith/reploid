import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,args:['--disable-gpu']});
const results=[];
for (const width of [1440,390,320]) {
 const page=await browser.newPage({viewport:{width,height:900},colorScheme:'light'});
 await page.goto('https://replo.id',{waitUntil:'networkidle'});
 await page.locator('[data-chat-workspace]').waitFor();
 const geometry=await page.evaluate(()=>[...document.querySelectorAll('.chat-thread-sidebar,.chat-network-rail,.chat-thread-sidebar .pool-button,.chat-network-rail .pool-button,.pool-seven-main,.pool-seven-small')].filter(n=>n.getClientRects().length).map(n=>{const b=n.getBoundingClientRect(),s=getComputedStyle(n);return {selector:n.className,box:b.toJSON(),width:s.width,minWidth:s.minWidth,padding:s.padding,boxSizing:s.boxSizing,font:s.font,transform:s.transform};}));
 await page.screenshot({path:`artifacts/rail-containment-20261013/live-before-${width}.png`,fullPage:true});
 await page.locator('[data-toggle-inspector]').click();
 await page.screenshot({path:`artifacts/rail-containment-20261013/live-network-before-${width}.png`,fullPage:true});
 results.push({width,geometry});await page.close();
}
await writeFile('artifacts/rail-containment-20261013/live-before.json',JSON.stringify(results,null,2));await browser.close();
