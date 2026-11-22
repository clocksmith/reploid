// Real browser WebAuthn ceremonies with a virtual authenticator. The model is a fixture.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {expect} from '@playwright/test';
import {createDailyApp} from '../../server/daily/http.js';
import {openDailyPasskeys} from '../../server/daily/passkeys.js';
import {createDailyStore} from '../../server/daily/store.js';
const server = createServer().listen(0,'127.0.0.1');
await once(server,'listening');
const origin = 'http://localhost:' + server.address().port;
const store = createDailyStore({path:':memory:',hostId:'test',hostDailyCap:10});
const grant = store.circleInvite({expiresAt:Date.now()+86400000});
const passkeys = openDailyPasskeys({file:':memory:',origin});
const staticRoot = fileURLToPath(new URL('../../server/daily/site/',import.meta.url));
let runs=0, browser;
const app = createDailyApp({store,staticRoot,passkeys,origin,publicInvite:grant.token,circleName:'Test GPU',
  gameForDay:day=>({day,digest:day,qualified:true,target:'Blue',banned:['blue'],ruleVersion:'fixture',modelId:'fixture'}),
  async run({onDispatch}) {onDispatch();return {output:'Blue',receipt:{fixture:true,sequence:++runs}};}
});
server.on('request',app);
try {
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  // Exercise the older native mobile API shape; the production journey covers modern JSON helpers.
  await context.addInitScript(() => {
    for (const name of ['parseCreationOptionsFromJSON','parseRequestOptionsFromJSON']) {
      Object.defineProperty(PublicKeyCredential,name,{configurable:true,value:undefined});
    }
    Object.defineProperty(PublicKeyCredential.prototype,'toJSON',{configurable:true,value:undefined});
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror',e => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,
    hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
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
  await expect(page.locator('#tries')).toHaveText('2 of 3 tries left');
  assert.equal(runs,1);
  await context.clearCookies();
  await page.reload();
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByRole('button',{name:'Use existing passkey'}).click();
  await expect(page.locator('#tries')).toHaveText('2 of 3 tries left');
  assert.equal(runs,1);
  store.revokeCircle(grant.id);
  await page.reload();
  await expect(page.getByLabel('Your prompt')).toBeHidden();
  assert.equal(runs,1);
  assert.deepEqual(errors,[]);
  console.log('Public draft → passkey → one scored turn; after clearing cookies the same passkey retained its budget. Revocation stopped public play.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  passkeys.close();store.close();
}
