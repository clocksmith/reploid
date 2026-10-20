import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const receipt={startedAt:new Date().toISOString(),passed:false,pages:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
const contexts=[];
try{
 const pages=[];
 for(let i=0;i<2;i++){const c=await browser.newContext();contexts.push(c);pages.push(await c.newPage());}
 await Promise.all(pages.map(async page=>{await page.goto('https://replo.id/',{waitUntil:'domcontentloaded'});await page.locator('[data-chat-workspace]').waitFor({timeout:15000});}));
 for(const page of pages){
  await page.locator('[data-toggle-inspector]').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-insp-device-list] [data-computer-auth]')].some(node=>node.textContent.startsWith('Authenticated identity observed')),null,{timeout:30000});
  receipt.pages.push({url:page.url(),readiness:await page.locator('[data-peer-readiness]').innerText(),authenticated:await page.locator('[data-insp-device-list] [data-computer-auth]').evaluateAll(nodes=>nodes.filter(node=>node.textContent.startsWith('Authenticated identity observed')).length)});
 }
 assert.equal(receipt.pages.length,2);receipt.passed=true;
}catch(error){receipt.error=error.message;process.exitCode=1;}
finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();receipt.finishedAt=new Date().toISOString();await writeFile(new URL('./app-probe.json', import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(receipt);}
