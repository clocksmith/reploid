import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Synthetic model bytes/transport; real pinned piece validation, hashes, OPFS,
// strict IndexedDB and chat workspace. This is not model numerical evidence.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value));
const weight = Buffer.from([1, 2, 3, 4, 5, 6]);
const manifest = encode({ modelId: 'storage-fixture', hashAlgorithm: 'sha256',
  tokenizer: { file: 'tokenizer.json' }, shards: [{ filename: 'weights.bin', size: weight.length, hash: digest(weight) }] });
const index = encode({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + digest(manifest),
  maxPieceBytes: 2, files: [{ path: 'weights.bin', size: 6, pieces: [0, 2, 4].map(offset =>
    ({ offset, size: 2, identity: 'sha256:' + digest(weight.subarray(offset, offset + 2)) })) }] });
const payloads = { 'manifest.json': manifest, 'pieces.json': index, 'tokenizer.json': encode({}), 'weights.bin': weight };
const model = { id: 'storage-fixture', name: 'Storage fixture', provider: 'doppler', contextLength: 8192, identity: 'sha256:' + digest(manifest), adapters: [],
  source: { baseUrl: 'https://model.fixture/', files: ['manifest.json', 'pieces.json', 'tokenizer.json'].map((path, i) =>
    ({ path, role: ['model-manifest', 'model-piece-index', 'tokenizer'][i], sizeBytes: payloads[path].length,
      hash: digest(payloads[path]), hashAlgorithm: 'sha256' })) } };
const allowance = manifest.length + index.length + 2;
async function install(context) {
  await context.route('**/config/chat-models.json', route => route.fulfill({json:[model]}));
}
async function open(page, { fail = false, ignoreRange = false, hold = false, corrupt = false } = {}) {
  await page.goto('/config/chat-files.json');
  await page.evaluate(async ({ payloads, fail, ignoreRange, hold, corrupt }) => {
    window.requests = []; window.offers = []; window.handlers = new Map();
    const transport = { _getPeerId: () => 'storage-fixture', onDataChannel: () => () => {},
      getConnectedPeers: () => [{ id: 'requester' }], onMessage: (type, fn) => window.handlers.set(type, fn),
      broadcast: (type, payload) => { if (type === 'reploid:custody-offer') window.offers.push(payload.artifacts); },
      sendToPeer: () => true };
    const {createWorkModelFiles} = await import('/host/work-model-files.js');
    const {LOCAL_DOPPLER_MODELS} = await import('/config/doppler-local-models.js');
    window.model = LOCAL_DOPPLER_MODELS[0];
    window.files = createWorkModelFiles({ getTransport: () => transport, fetchImpl: async (url, controls) => {
      const path = new URL(url).pathname.slice(1), range = controls.headers?.Range;
      window.requests.push({path,range,charged:window.files.getState().acquisitionBudget?.reservedBytes});
      if (hold) await new Promise((resolve,reject) => {
        window.releaseDownload = resolve;
        controls.signal.addEventListener('abort', () => reject(controls.signal.reason), {once:true});
      });
      if (fail) throw new Error('Fixture transfer failure');
      const source = new Uint8Array(payloads[path]);
      if (range && corrupt) source[0] ^= 255;
      if (range && !ignoreRange) {
        const [,start,end] = /bytes=(\d+)-(\d+)/.exec(range);
        return new Response(source.slice(Number(start), Number(end)+1), {status:206,
          headers:{'content-range':`bytes ${start}-${end}/${source.length}`}});
      }
      return new Response(source);
    } });
  }, {payloads:Object.fromEntries(Object.entries(payloads).map(([k,v])=>[k,[...v]])),fail,ignoreRange,hold,corrupt});
}
const share = (page, mode = 'bounded-acquisition', downloadBytes = allowance) =>
  page.evaluate(async ({mode,downloadBytes}) => {
    try { await window.files.share(window.model,true,{mode,downloadBytes}); }
    catch (e) { return {error:e.message,state:window.files.getState()}; }
    return {state:window.files.getState(),inventory:window.offers.at(-1),requests:window.requests};
  },{mode,downloadBytes});

async function beginChat(page) {
  await page.evaluate(async()=>{
    const {createChatSession}=await import('/host/chat-session.js');
    window.chat=createChatSession({storage:null,models:[window.model],swarm:{
      shareFiles:(model,approved,controls)=>window.files.share(model,approved,controls),stopFiles:()=>window.files.stop()},
      scheduler:{getState:()=>({}),close:async()=>{},async schedule(request,controls){
        window.chatSignal=controls.signal;await new Promise(resolve=>{window.releaseChat=resolve;});
        return {content:'Conversation completed',model:request.model.id,modelIdentity:request.model.identity,adapterIdentities:[]};
      }}});
    const id=window.chat.createThread({sharingScope:'local'});
    window.chatResult=window.chat.send(id,'Keep chatting');
  });
  await expect.poll(()=>page.evaluate(()=>!!window.chatSignal)).toBe(true);
}

test('a fresh storage-only requester acquires a verified subset; reload preserves inventory and allowance', async ({page,context}) => {
  await install(context); await open(page);await beginChat(page);
  const first = await share(page);
  expect(first.error).toBeUndefined();
  expect(first.requests.map(x=>x.path)).toEqual(['manifest.json','pieces.json','weights.bin']);
  expect(first.requests.at(-1).range).toBe('bytes=0-1');
  expect(first.requests.at(-1).charged).toBe(allowance);
  expect(first.inventory.filter(x=>x.path.startsWith('piece-'))).toHaveLength(1);
  expect(first.state.acquisitionBudget.reservedBytes).toBe(allowance);
  const conversation=await page.evaluate(async()=>{
    await window.chat.setFileSharing(false,window.model.id,false);
    const aborted=window.chatSignal.aborted;window.releaseChat();
    const result=await window.chatResult;await window.chat.close();await window.files.close();return {aborted,result};
  });
  expect(conversation.aborted).toBe(false);expect(conversation.result.status).toBe('completed');
  await open(page);
  const cached = await share(page,'cached-only');
  expect(cached.error).toBeUndefined();expect(cached.requests).toEqual([]);
  expect(cached.inventory).toEqual(first.inventory);
  expect(cached.state.acquisitionBudget.reservedBytes).toBe(allowance);
  await page.evaluate(()=>window.files.stop());
  const resumed = await share(page);
  expect(resumed.error).toBeUndefined();expect(resumed.requests).toEqual([]);
  expect(resumed.state.acquisitionBudget.reservedBytes).toBe(allowance);
  await page.evaluate(()=>window.files.stop());
  const renewed = await share(page,'bounded-acquisition',allowance+2);
  expect(renewed.error).toContain('cannot be renewed');
  await page.evaluate(()=>window.files.close());
});

test('fresh cache-only and missing metadata perform zero downloads', async ({page,context}) => {
  await install(context);await open(page);
  const empty = await share(page,'cached-only');
  expect(empty.error).toContain('cached');
  expect(await page.evaluate(()=>window.requests)).toEqual([]);
  expect(empty.state.acquisitionBudget).toBeNull();
  const first = await share(page);expect(first.error).toBeUndefined();
  await page.evaluate(async hash=>{await window.files.stop();const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');await folder.removeEntry('sha256-'+hash);},digest(manifest));
  await page.evaluate(()=>{window.requests=[];});
  const missing=await share(page,'cached-only');expect(missing.error).toContain('cached');
  expect(await page.evaluate(()=>window.requests)).toEqual([]);
  await page.evaluate(()=>window.files.close());
});

test('evicted supplier bytes withdraw availability without origin fallback', async ({page,context}) => {
  await install(context);await open(page);expect((await share(page)).error).toBeUndefined();
  await page.evaluate(async()=>{
    const artifact=window.offers.at(-1).find(f=>f.path.startsWith('piece-'));
    const folder=await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
    await folder.removeEntry(artifact.hashAlgorithm+'-'+artifact.hash);window.requests=[];
    window.handlers.get('reploid:custody-request')('requester',{id:'missing',artifact,
      requester:{peerId:'requester',publicKey:'fixture'},maxExpiresAt:Date.now()+10000});
  });
  await expect.poll(()=>page.evaluate(()=>window.files.getState().sharing)).toBe(false);
  expect(await page.evaluate(()=>window.requests)).toEqual([]);
  expect(await page.evaluate(()=>window.files.getState().error)).toContain('cached');
  await page.evaluate(()=>window.files.close());
});

test('failed metadata attempts remain charged across retries and reload', async ({page,context}) => {
  await install(context);await open(page,{fail:true});
  const cap=manifest.length*2;
  expect((await share(page,'bounded-acquisition',cap)).error).toContain('transfer failure');
  expect((await share(page,'bounded-acquisition',cap)).state.acquisitionBudget.reservedBytes).toBe(cap);
  await page.evaluate(()=>window.files.close());await open(page,{fail:true});
  const denied=await share(page,'bounded-acquisition',cap);
  expect(denied.error).toContain('exhausted');expect(await page.evaluate(()=>window.requests)).toEqual([]);
  await page.evaluate(()=>window.files.close());
});

test('bounded acquisition rejects an origin ignoring a piece range', async ({page,context}) => {
  await install(context);await open(page,{ignoreRange:true});
  const rejected=await share(page);expect(rejected.error).toContain('exact piece range');
  expect(rejected.state.sharing).toBe(false);expect(rejected.state.acquisitionBudget.reservedBytes).toBe(allowance);
  await page.evaluate(()=>window.files.close());
});

test('a corrupt acquired piece consumes its reservation without becoming shareable', async ({page,context}) => {
  await install(context);await open(page,{corrupt:true});
  const failed=await share(page);expect(failed.error).toContain('integrity mismatch');
  expect(failed.state.sharing).toBe(false);expect(failed.state.acquisitionBudget.reservedBytes).toBe(allowance);
  await page.evaluate(()=>window.files.stop());
  const cached=await share(page,'cached-only');expect(cached.error).toContain('No verified model pieces');
  await page.evaluate(()=>window.files.close());
});

test('full-model choice retains deliberate full-file acquisition', async ({page,context}) => {
  await install(context);await open(page);
  const full=await share(page,'full-model',allowance+100);
  expect(full.error).toBeUndefined();expect(full.requests.map(x=>x.path)).toEqual(['manifest.json','pieces.json','tokenizer.json','weights.bin']);
  expect(full.requests.every(x=>!x.range)).toBe(true);
  expect(full.inventory.some(x=>x.path==='weights.bin')).toBe(true);
  await page.evaluate(()=>window.files.close());await open(page);
  const retained=await share(page,'cached-only');expect(retained.error).toBeUndefined();
  expect(retained.requests).toEqual([]);expect(retained.inventory.filter(x=>x.path.startsWith('piece-'))).toHaveLength(3);
  await page.evaluate(()=>window.files.close());
});

test('stopping storage acquisition settles its transfer while a chat continues', async ({page,context}) => {
  await install(context);await open(page,{hold:true});
  await beginChat(page);
  await page.evaluate(allowance=>{
    window.sharingResult=window.chat.setFileSharing(true,window.model.id,true,{mode:'bounded-acquisition',downloadBytes:allowance}).catch(e=>e.message);
  },allowance);
  await expect.poll(()=>page.evaluate(()=>window.requests.length)).toBe(1);
  const result=await page.evaluate(async()=>{
    await window.chat.setFileSharing(false,window.model.id,false);
    const aborted=window.chatSignal.aborted;window.releaseChat();
    return {aborted,sharing:await window.sharingResult,chat:await window.chatResult,state:window.files.getState()};
  });
  expect(result.aborted).toBe(false);expect(result.sharing).toContain('stopped');
  expect(result.chat.status).toBe('completed');expect(result.state.sharing).toBe(false);
  expect(result.state.acquisitionBudget.reservedBytes).toBe(manifest.length);
  await page.evaluate(async()=>{await window.chat.close();await window.files.close();});
});

test('competing host tabs cannot overspend one acquisition allowance', async ({page,context}) => {
  await install(context);await open(page);const other=await context.newPage();await open(other);
  const cap=(manifest.length+index.length)*2+2;
  const outcomes=await Promise.all([share(page,'bounded-acquisition',cap),share(other,'bounded-acquisition',cap)]);
  expect(outcomes.some(result=>!result.error)).toBe(true);
  const requests=(await Promise.all([page,other].map(p=>p.evaluate(()=>window.requests)))).flat();
  const requested=requests.reduce((n,r)=>n+(r.range?2:payloads[r.path].length),0);
  const state=await page.evaluate(async cap=>{
    const {openBrowserAcquisitionBudget}=await import('/infrastructure/custody-supply-budget.js');
    const ledger=await openBrowserAcquisitionBudget({maxBytes:cap,allowInitialize:true});
    const state=ledger.getState();ledger.close();return state;
  },cap);
  expect(state.reservedBytes).toBe(requested);expect(requested).toBeLessThanOrEqual(cap);
  await Promise.all([page,other].map(p=>p.evaluate(()=>window.files.close())));await other.close();
});

test('storage contribution changes pass the real Verification Worker', async ({page}) => {
 const paths=['self/host/work-model-files.js','self/host/work-swarm.js','self/host/chat-session.js',
  'self/infrastructure/custody-supply-budget.js','self/ui/pool-home/network-controls.js',
  'packages/reploid/src/artifacts/custody/exchange.js','packages/reploid/src/artifacts/custody/supply-budget.js'];
 const snapshot=Object.fromEntries(await Promise.all(paths.map(async path=>[path.replace(/^self/,''),await readFile(path,'utf8')])));
 await page.goto('/config/chat-files.json');
 const result=await page.evaluate(snapshot=>new Promise((resolve,reject)=>{
  const worker=new Worker('/core/verification-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},15000);
  worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();resolve(data);};worker.postMessage({type:'VERIFY',snapshot});
 }),snapshot);
 expect(result.errors).toEqual([]);expect(result.passed).toBe(true);
});

test('actual pinned model origin supplies one bounded verified piece without compute', async ({page}, testInfo) => {
 test.skip(process.env.REPLOID_STORAGE_ORIGIN_CHECK !== '1', 'Explicit bounded network check');
 await page.goto('/config/chat-files.json');
 const evidence=await page.evaluate(async()=>{
  const {createWorkModelFiles}=await import('/host/work-model-files.js');
  const {LOCAL_DOPPLER_MODELS}=await import('/config/doppler-local-models.js');
  const model=LOCAL_DOPPLER_MODELS.find(m=>m.id==='qwen-3-5-0-8b-q4k-ehaf16');
  const metadata=model.source.files.filter(f=>['model-manifest','model-piece-index'].includes(f.role));
  const allowance=metadata.reduce((n,f)=>n+f.sizeBytes,0)+4194304;
  const requests=[], offers=[];
  const transport={_getPeerId:()=> 'storage-origin-check',onDataChannel:()=>()=>{},getConnectedPeers:()=>[],onMessage:()=>{},
   broadcast:(type,value)=>{if(type==='reploid:custody-offer')offers.push(value.artifacts);},sendToPeer:()=>true};
  let files;
  files=createWorkModelFiles({getTransport:()=>transport,fetchImpl:async(url,controls)=>{
   requests.push({url,range:controls.headers?.Range||null,reservedBytes:files.getState().acquisitionBudget.reservedBytes});
   return fetch(url,controls);
  }});
  try {
   await files.share(model,true,{mode:'bounded-acquisition',downloadBytes:allowance});
   const result={modelId:model.id,identity:model.identity,allowance,requests,inventory:offers.at(-1),state:files.getState()};
   await files.stop();return {...result,stopped:!files.getState().sharing};
  } finally {await files.close();}
 });
 await testInfo.attach('bounded-origin-evidence',{body:JSON.stringify(evidence,null,2),contentType:'application/json'});
 expect(evidence.inventory.filter(f=>f.path.startsWith('piece-'))).toHaveLength(1);
 expect(evidence.state.acquisitionBudget.reservedBytes).toBe(evidence.allowance);expect(evidence.stopped).toBe(true);
 expect(evidence.requests.at(-1).range).toBe('bytes=0-4194303');
});
