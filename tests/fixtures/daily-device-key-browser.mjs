// Real browser device-key sign-in with WebCrypto and IndexedDB. The model is a fixture.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {expect} from '@playwright/test';
import {createDailyApp} from '../../server/daily/http.js';
import {openDailyDeviceKeys} from '../../server/daily/device-keys.js';
import {createDailyStore} from '../../server/daily/store.js';
import {TURNS_PER_DAY} from '../../server/daily/rules.js';
const server = createServer().listen(0,'127.0.0.1');
await once(server,'listening');
const origin = 'http://localhost:' + server.address().port;
const store = createDailyStore({path:':memory:',hostId:'test',hostDailyCap:10});
const grant = store.circleInvite({expiresAt:Date.now()+86400000});
const deviceKeys = openDailyDeviceKeys({file:':memory:',origin});
const staticRoot = fileURLToPath(new URL('../../server/daily/site/',import.meta.url));
let runs=0, browser;
const app = createDailyApp({store,staticRoot,deviceKeys,origin,publicInvite:grant.token,circleName:'Test GPU',
  gameForDay:day=>({day,digest:day,qualified:true,target:'Blue',banned:['blue'],ruleVersion:'fixture',modelId:'fixture'}),
  async run({onDispatch}) {onDispatch();return {output:'Blue',receipt:{fixture:true,sequence:++runs}};}
});
server.on('request',app);
try {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',e => errors.push(e.message));
  await page.goto(origin);
  await expect(page.getByLabel('Your prompt')).toBeVisible();
  await expect(page.locator('#rules')).toBeHidden();
  await expect(page.locator('#scores')).toBeHidden();
  assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth));
  assert((await page.locator('body').innerText()).split(/\s+/).length < 60);
  await page.getByLabel('Your prompt').fill('Sky');
  await page.getByRole('button',{name:'Submit prompt'}).click();
  await expect(page.locator('#join')).toBeVisible();
  await page.getByRole('button',{name:'Join game'}).click();
  await expect(page.locator('#history')).toContainText('Matched in 1 word');
  await expect(page.locator('#tries')).toHaveText((TURNS_PER_DAY - 1) + ' of ' + TURNS_PER_DAY + ' tries left');
  assert.equal(runs,1);
  const algorithm = await page.evaluate(() => new Promise((resolve,reject) => {
    const open = indexedDB.open('reploid-daily');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const get = open.result.transaction('device-key').objectStore('device-key').get('player');
      get.onsuccess = () => resolve({name:get.result.privateKey.algorithm.name,extractable:get.result.privateKey.extractable});
    };
  }));
  assert.equal(algorithm.extractable,false);
  await context.clearCookies();
  await page.reload();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Join game'}).click();
  await expect(page.locator('#tries')).toHaveText((TURNS_PER_DAY - 1) + ' of ' + TURNS_PER_DAY + ' tries left');
  assert.equal(runs,1);
  // A browser without Ed25519 falls back to a non-extractable ECDSA P-256 key.
  const older = await browser.newContext({viewport:{width:390,height:844}});
  await older.addInitScript(() => {
    const generate = crypto.subtle.generateKey.bind(crypto.subtle);
    crypto.subtle.generateKey = (algorithm,...rest) => algorithm?.name === 'Ed25519'
      ? Promise.reject(new DOMException('Unsupported','NotSupportedError')) : generate(algorithm,...rest);
  });
  const olderPage = await older.newPage();
  olderPage.on('pageerror',e => errors.push(e.message));
  await olderPage.goto(origin);
  await olderPage.getByLabel('Your prompt').fill('Sky');
  await olderPage.getByRole('button',{name:'Submit prompt'}).click();
  await olderPage.getByRole('button',{name:'Join game'}).click();
  await expect(olderPage.locator('#tries')).toHaveText((TURNS_PER_DAY - 1) + ' of ' + TURNS_PER_DAY + ' tries left');
  assert.equal(runs,2);
  await older.close();
  store.revokeCircle(grant.id);
  await page.reload();
  await expect(page.getByLabel('Your prompt')).toBeHidden();
  assert.equal(runs,2);
  assert.deepEqual(errors,[]);
  console.log('Public draft → ' + algorithm.name + ' device key → one scored turn; after clearing cookies the same device key retained its budget; the ECDSA P-256 fallback also signed in. Revocation stopped public play.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  deviceKeys.close();store.close();
}
