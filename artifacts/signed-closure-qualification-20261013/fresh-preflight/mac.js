import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { physicalWebGpuBrowserOptions } from '/var/tmp/reploid-closure-qualification-20261013/tests/fixtures/physical-webgpu-browser.js';
const require = createRequire('/Users/xyz/deco/reploid/package.json');
const { chromium } = require('playwright');
const browser = await chromium.launch(physicalWebGpuBrowserOptions(process.platform));
try {
 const cdp = await browser.newBrowserCDPSession();
 const { arguments: argumentsList } = await cdp.send('Browser.getBrowserCommandLine');
 const executable = argumentsList[0];
 if (!executable?.startsWith('/')) throw Error('Actual browser executable path missing');
 await cdp.detach();
 const context = await browser.newContext();
 const page = await context.newPage();
 await page.goto('http://127.0.0.1:29850/config/doppler-package.json');
 const provider = await page.evaluate(async () => {
   const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
   if (!adapter) throw Error('Missing physical adapter');
   const info = adapter.info;
   return { userAgent: navigator.userAgent, platform: navigator.platform,
     adapter: { vendor: info.vendor || 'unknown', architecture: info.architecture || 'unknown', device: info.device || 'unknown', description: info.description || '' } };
 });
 const result = { scope: 'Fresh adapter-only preflight; no GPUDevice, model, kernels or inference', at: new Date().toISOString(), host: hostname(),
   browser: browser.version(), executable: { path: executable, sha256: createHash('sha256').update(await readFile(executable)).digest('hex') }, provider };
 await context.close();
 await writeFile('/var/tmp/reploid-closure-qualification-output-20261013/fresh-mac-preflight.json', JSON.stringify(result, null, 2)+'\n');
 console.log(JSON.stringify(result));
} finally { await browser.close(); }
