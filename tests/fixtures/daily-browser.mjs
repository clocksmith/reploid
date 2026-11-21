// Run with node tests/fixtures/daily-browser.mjs. Identity and inference are fixtures.
// The pages, network calls, invitations, score store and browser isolation are real.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { createDailyStore } from '../../server/daily/store.js';
import { createDailyApp } from '../../server/daily/http.js';

const staticRoot = fileURLToPath(new URL('../../server/daily/site/',import.meta.url));
const clock = () => time;
let time = Date.parse('2026-11-21T13:00:00Z');
let runs = 0;
const store = createDailyStore({path:':memory:',hostId:'browser-fixture',hostDailyCap:5,now:clock});
const grant = store.circleInvite({expiresAt:time + 4 * 86400_000});
const app = createDailyApp({store,staticRoot,clock,circleName:'Browser test circle',
  gameForDay:day => ({day,digest:'fixture-' + day,qualified:true,target:'Blue.',banned:['blue'],ruleVersion:'fixture',modelId:'fixture'}),
  identity:{async start() {},async verify(email,code) {return code === '123456' ? email : null;}},
  async run({onDispatch}) {onDispatch(); runs++; return {output:'Blue!',receipt:{fixture:true,sequence:runs}};}
});
const server = app.listen(0,'127.0.0.1');
await once(server,'listening');
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL ? {channel:process.env.PLAYWRIGHT_CHANNEL} : {})});
  const open = async (url,width = 1200) => {
    const context = await browser.newContext({viewport:{width,height:900}});
    const page = await context.newPage();
    page.on('pageerror',error => { throw error; });
    await page.goto(url);
    await expect(page.locator('#target')).toHaveText('Blue.');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    return page;
  };
  const login = async (page,email) => {
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByLabel('Email to play').fill(email);
    await page.getByRole('button',{name:'Send code'}).click();
    await page.getByLabel('Email code').fill('123456');
    await page.getByRole('button',{name:'Verify code'}).click();
    await expect(page.locator('#auth')).toBeHidden();
  };
  const play = async (page,prompt) => {
    await page.getByLabel('Your prompt').fill(prompt);
    const response = page.waitForResponse(r => r.url() === origin + '/api/attempt' && r.request().method() === 'POST');
    await page.getByRole('button',{name:'Submit prompt'}).click();
    assert.equal((await (await response).json()).attempt.prompt,prompt);
    await expect(page.locator('#history .attempt')).toContainText('Blue!');
  };
  const share = async (page,allowReveal = false) => {
    const row = page.locator('#history .attempt').last();
    await row.getByRole('button',{name:'Share this win'}).click();
    const sheet = page.locator('#share-sheet');
    if (allowReveal) await sheet.getByRole('checkbox').check();
    await sheet.getByRole('button',{name:'Get dare link'}).click();
    const field = sheet.getByLabel('Dare link with the circle invitation');
    await expect(field).toBeVisible();
    const url = await field.inputValue();
    await sheet.getByRole('button',{name:'Close'}).click();
    return url;
  };
  const entry = origin + '/#invite=' + grant.token;
  const alice = await open(entry);
  await login(alice,'a@example.test');
  await play(alice,'Color of sky');
  const first = await share(alice);
  const bob = await open(first,390);
  await expect(bob.locator('#dare-score')).toHaveText('Beat 3 words.');
  await bob.getByText('View recorded answer').click();
  await expect(bob.locator('#dare-output')).toHaveText('Blue!');
  await bob.locator('#replay').getByRole('button',{name:'Close'}).click();
  assert.equal(runs,1);
  assert(!await bob.content().then(html => html.includes('Color of sky')));
  await login(bob,'b@example.test'); await play(bob,'Ocean hue');
  const second = await share(bob);
  assert.equal(new URL(second).hash,new URL(first).hash);
  const third = await open(second);
  await login(third,'c@example.test'); await play(third,'Sky');
  await share(third,true);
  assert.equal(store.metrics().thirdParticipants,1);
  const returning = await open(entry);
  await login(returning,'c@example.test');
  await expect(returning.locator('#tries')).toHaveText('2 of 3 tries left');
  await play(returning,'Ocean'); await play(returning,'Daylight');
  await expect(returning.locator('#tries')).toHaveText('0 of 3 tries left');
  const full = await open(first);
  await expect(full.locator('#status')).toContainText('Host your own');
  await full.getByText('View recorded answer').click();
  await expect(full.locator('#dare-output')).toHaveText('Blue!');
  assert.equal(runs,5);
  time += 86400_000;
  await full.reload();
  await expect(full.locator('#yesterday')).toHaveText('No reviewed winning prompts to show.');
  const [winner] = store.reviewQueue();
  assert.equal(winner.prompt,'Sky');
  store.reviewReveal(winner.attemptId);
  await full.reload();
  await expect(full.locator('#yesterday')).toContainText('Sky');
  await expect(full.locator('#dare-score')).toContainText('Played on 2026-11-21');
  await third.reload();
  await third.getByRole('button',{name:'Scores'}).click();
  await third.getByText('Yesterday’s winners',{exact:true}).click();
  await third.getByRole('button',{name:'Withdraw my prompt: Sky'}).click();
  await expect(third.locator('#yesterday')).toHaveText('No reviewed winning prompts to show.');
  await full.reload();
  await expect(full.locator('#yesterday')).toHaveText('No reviewed winning prompts to show.');
  assert.equal(runs,5);
  console.log('Passed browser journey: three guests, five fixture runs, two playable dares, full-host replay, stable attempts and moderated reveal.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  store.close();
}
