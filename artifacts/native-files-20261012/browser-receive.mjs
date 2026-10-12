import { chromium } from '/Users/xyz/deco/reploid/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
 const context = await browser.newContext(), page = await context.newPage();
 const network = [];
 page.on('request', request => network.push(request.url()));
 page.on('console', msg => console.log('BROWSER',msg.type(),msg.text()));
 await page.goto('http://localhost:8000/config/chat-models.json');
 const result = await page.evaluate(async () => {
  const [{ createSwarmTransport }, { resolveConfig }, { createSigningIdentity }, { createWorkModelFiles }] = await Promise.all([
   import('/vendor/reploid/transport/index.js'), import('/vendor/reploid/config/index.js'),
   import('/vendor/reploid/artifacts/identity.js'), import('/host/work-model-files.js')]);
  const [profile, bootstrap, models] = await Promise.all(['/config/reploid-library.json','/config/swarm-bootstrap.json','/config/chat-models.json'].map(url => fetch(url).then(r => r.json())));
  const identity = await createSigningIdentity({ algorithm: 'Ed25519' }), target = 'c2ae6385-8626-4442-95f7-995b3886ba5d';
  const config = resolveConfig({ profile: profile.profile, overrides: { mesh: { enabled: true, executeJobs: false, roomId: bootstrap.publicRoomId },
   webrtc: { signalingUrl: `ws://localhost:8000/swarm?scope=public&roomId=${bootstrap.publicRoomId}`, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'] } } });
  const listeners = new Map();
  const transport = createSwarmTransport({ config, Utils: { logger: console, generateId: () => crypto.randomUUID() },
   EventBus: { emit(name,payload) { for (const fn of listeners.get(name)||[]) fn(payload); }, on(name,fn) { const rows=listeners.get(name)||[];rows.push(fn);listeners.set(name,rows);return()=>{}; } },
   getSessionId: () => identity.peerId, getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }),
   introductions: { getIdentity: () => identity, authorize: async request => request.roomId===bootstrap.publicRoomId && request.action!=='forward' } });
  let files, source, timer;
  try {
   await transport.init();
   const filtered = { ...transport, getConnectedPeers: () => transport.getConnectedPeers().filter(peer => peer.id===target),
    sendToPeer: (peer,...args) => peer===target && transport.sendToPeer(peer,...args),
    broadcast: (...args) => transport.sendToPeer(target,...args),
    onMessage: (type,handler) => transport.onMessage(type,(peer,message)=>{if(peer===target)handler(peer,message);}),
    onDataChannel: (label,handler) => transport.onDataChannel(label,(peer,channel)=>{if(peer===target)handler(peer,channel);else channel.close();}) };
   files = createWorkModelFiles({ getTransport: () => filtered }); await files.attach();
   timer = setInterval(() => files.announce(), 200);
   const deadline=Date.now()+20000;
   while(Date.now()<deadline && !files.getState().peers.includes(target)) await new Promise(r=>setTimeout(r,100));
   const model=models.find(m=>m.id==='qwen-3-5-0-8b-q4k-ehaf16');
   console.log('DIAG',JSON.stringify({peers:transport.getConnectedPeers(),state:files.getState()}));
   source=await files.preparePartitionSource(model,{signal:AbortSignal.timeout(60000)});
   const bytes=new Uint8Array(await source.storage.loadShardRange(0,0,8));
   return { supplier:target, requesterTransport:transport._getPeerId(), returnedBytes:[...bytes],source:source.getReceipt(),files:files.getState(),userAgent:navigator.userAgent };
  } catch(error) { return {error:error.message,peers:transport.getConnectedPeers(),files:files?.getState(),requesterTransport:transport._getPeerId()}; } finally {clearInterval(timer);await source?.storage.close();await files?.close();transport.disconnect();}
 });
 await fs.writeFile('/Users/xyz/deco/reploid/artifacts/native-files-20261012/browser-receive.json',JSON.stringify({...result,network},null,2));
 console.log(JSON.stringify(result));
} finally {await browser.close();}
