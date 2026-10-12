import { chromium } from 'playwright';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { observeResidentOpening, residentOpeningBoundary } from '../../tests/fixtures/resident-opening-observer.js';

const factorySource = `export async function open() { const allocation={index:1,planId:'synthetic-plan',model:{identity:'synthetic-model'}};const opened={advanced:{getResolvedRuntimeSession:()=>({observed:42})}};let handle;
handle = opened;
return handle; }`;
const identitySource = 'export function observeInitialExecutionIdentity(resolved) { return { observed: resolved.observed, synthetic: true }; }';
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/javascript');
  res.end(req.url.endsWith('resident-partitions.js') ? factorySource : req.url.endsWith('initial-execution-identity.js') ? identitySource : '');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, observer;
const receipt = { scope: 'Actual CDP observer plumbing with synthetic JS modules; Chromium --disable-gpu, no model, no physical qualification' };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage(), base = `http://127.0.0.1:${server.address().port}/`;
  await page.goto(base);
  observer = await observeResidentOpening(page, { runtimeBaseUrl: base, factorySource, identitySource });
  await page.evaluate(async url => { await (await import(url)).open(); }, base + 'client/resident-partitions.js');
  receipt.observation = await observer.finish();
  if (receipt.observation.initialExecutionIdentity.observed !== 42) throw Error('Actual lexical value differs');
  receipt.passed = true; receipt.browser = browser.version();
  const archive = '../doppler/reports/local/paired-intermediates-20261012/package-8/doppler-gpu-0.6.27.tgz';
  const bytes = await readFile(archive), archiveSha256 = createHash('sha256').update(bytes).digest('hex');
  if (archiveSha256 !== '8ea1767fb61d9009dd257c4065a6acfdbaaf80fa733145898307ed35da0e7f20') throw Error('Archive8 differs');
  const actual = execFileSync('tar', ['-xOf', archive, 'package/src/client/resident-partitions.js'], { encoding: 'utf8' });
  receipt.archiveFactoryBoundary = { scope: 'No execution; exact archive8 factory has unique observation boundary',
    archiveSha256, line: residentOpeningBoundary(actual), sha256: createHash('sha256').update(actual).digest('hex') };
} catch (error) { receipt.passed = false; receipt.error = error.stack; throw error; }
finally {
  await observer?.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
  receipt.observerSha256 = createHash('sha256').update(await readFile('tests/fixtures/resident-opening-observer.js')).digest('hex');
  await writeFile(new URL('./observer-cdp-control.json', import.meta.url), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
