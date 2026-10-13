import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root='/var/tmp/reploid-cold-compile-three-stage-20261013';
const out=process.argv[2];
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
 const deadline=Date.now()+1740000;
 while(Date.now()<deadline){try{await access(out+'.stop');break;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}
} finally {await browser.close();console.log('Owned Chromium closed');}
