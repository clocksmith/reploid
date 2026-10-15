import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Placement C copy of ../../completion-candidate-20261013/mac-owner.js. Differences: the fixture root, and an
// optional second argument replacing the 1,740,000 ms owner deadline (c6 onward: 3,540,000 ms, matching the
// natives), because attempt c5's capture outlasted the original deadline during mac-host network stalls.
const root='/var/tmp/reploid-faster-candidate-20261015';
const out=process.argv[2];
const ownerDeadlineMs=process.argv[3]===undefined?1740000:Number(process.argv[3]);
if(!Number.isSafeInteger(ownerDeadlineMs)||ownerDeadlineMs<=0||ownerDeadlineMs>3540000)throw Error('Owner deadline must be at most 3,540,000 ms');
const { chromium }=await import(root+'/node_modules/playwright/index.mjs');
const { physicalWebGpuBrowserOptions }=await import(root+'/tests/fixtures/physical-webgpu-browser.js');
const options=physicalWebGpuBrowserOptions('darwin');options.args.push('--remote-debugging-port=29993');
const browser=await chromium.launch(options);
try {
 const session=await browser.newBrowserCDPSession();
 const {arguments:args}=await session.send('Browser.getBrowserCommandLine');
 const {processInfo}=await session.send('SystemInfo.getProcessInfo');
 const bytes=await readFile(args[0]);
 await writeFile(out,JSON.stringify({executorId:'mac-stage-0',platform:'mac.lan',endpoint:'http://127.0.0.1:29993',pid:processInfo.find(x=>x.type==='browser').id,browserVersion:browser.version(),executableIdentity:{path:args[0],sha256:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length},observedAt:new Date().toISOString()},null,2)+'\n');
 await session.detach();console.log('Owned Chromium ready for bounded reference run');
 const deadline=Date.now()+ownerDeadlineMs;
 while(Date.now()<deadline){try{await access(out+'.stop');break;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
} finally {await browser.close();console.log('Owned Chromium closed');}
