import { QUOTE_CASES, extractQuoteCode, evaluateQuoteCode } from '../fixtures/quote-code-evaluation.js';
import { test, expect } from '@playwright/test';
const evidenceDir = process.env.REPLOID_E2E_ARTIFACT_DIR || 'artifacts/network-home-2026-09-19';
import { readFile } from 'node:fs/promises';
import { servedPathOf } from '../../server/browser-roots.js';
import { readServedText } from '../helpers/served-browser-files.js';

const candidateCode = '({text}) => { let s = text.replace(/^\\uFEFF/, "").trim(); if(s.startsWith("```json\\n") && s.endsWith("\\n```")) s=s.slice(8,-4); return JSON.stringify(JSON.parse(s),null,2); }';

test('candidate isolation blocks network and storage and terminates looping work', async ({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {runIsolatedCode}=await import('/infrastructure/code-sandbox.js');
    const options={timeoutMs:300,maxResultBytes:1000};
    const check=async(code)=>{try{return await runIsolatedCode(code,{},options);}catch(e){return e.message;}};
    return {value:await check('() => 42'),network:await check('async () => (await fetch("https://example.com/leak")).status'),
      storage:await check('() => localStorage.getItem("secret")'),loop:await check('() => { while(true) {} }'),frames:document.querySelectorAll('iframe[sandbox]').length};
  });
  expect(result.value).toBe(42);expect(typeof result.network).toBe('string');expect(result.storage).toMatch(/localStorage|Security/);
  expect(result.loop).toContain('time limit');expect(result.frames).toBe(0);
});

test('new integration modules pass the Verification Worker',async({page})=>{
  const paths=['apps/poolday/host/work-model-files.js','apps/poolday/host/work-session.js','apps/poolday/host/work-helpers.js','apps/poolday/host/work-swarm.js','apps/poolday/host/work-evolution.js',
    'apps/poolday/infrastructure/code-sandbox.js', 
    'apps/poolday/host/work-view.js','packages/reploid/src/improvement/code-evolution.js',
    'apps/poolday/providers/work-network-provider.js', 
    'packages/reploid/src/mesh/peer-generation.js'];
  const snapshot=Object.fromEntries(await Promise.all(paths.map(async path=>servedPathOf(path)===null?[path,await readFile(path,'utf8')]:['/'+servedPathOf(path),await readServedText(servedPathOf(path))])));
  await page.goto('/');
  const result=await page.evaluate(snapshot=>new Promise((resolve,reject)=>{
    const worker=new Worker('/core/verification-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('Timeout'));},10000);
    worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();resolve(data);};worker.postMessage({type:'VERIFY',snapshot});
  }),snapshot);
  expect(result.errors).toEqual([]);expect(result.passed).toBe(true);
});

test('timed-out work waits for borrowed inference, preserves the failure and reloads its checkpoint', async ({ page }) => {
  await page.goto('/');
  await page.clock.install();
  const timeoutMs = await page.evaluate(async () => {
    const { createWorkSession, DEFAULT_WORK_MODELS } = await import('/host/work-session.js');
    const { default: policy } = await import('/config/work-profile.json', { with: { type: 'json' } });
    let release;
    const borrowed = new Promise(resolve => { release = resolve; });
    window.recoveryFixture = { entered: false, release };
    const model = DEFAULT_WORK_MODELS[0];
    const app = createWorkSession({ storage: localStorage, service: { isSupported: () => true, close: async () => {},
      async open() { return { async *stream() { window.recoveryFixture.entered = true; await borrowed;
        yield { type: 'text-delta', text: 'late response' }; } }; } } });
    Object.assign(window.recoveryFixture, { app, model });
    window.recoveryFixture.task = app.start({ goal: 'Exercise timeout recovery', modelId: model.id });
    return policy.profile.config.agent.timeoutMs;
  });
  await expect.poll(() => page.evaluate(() => window.recoveryFixture.entered)).toBe(true);
  await page.clock.fastForward(timeoutMs);
  expect(await page.evaluate(() => window.recoveryFixture.app.getState().busy)).toBe(true);
  const result = await page.evaluate(async () => {
    const { release, model, task } = window.recoveryFixture;
    release(new Response(JSON.stringify({ content: 'late response', model: model.id })));
    return task;
  });
  expect(result).toMatchObject({ status: 'paused', error: 'Work deadline reached', checkpointAvailable: true, output: '' });
  await page.reload();
  const restored = await page.evaluate(async () => {
    const { createWorkSession } = await import('/host/work-session.js');
    const app = createWorkSession({ storage: localStorage });
    const record = app.getState().records[0]; await app.close(); return record;
  });
  expect(restored).toMatchObject({ status: 'paused', error: 'Work deadline reached', checkpointAvailable: true });
});

test('two browsers exchange an approved text request over WebRTC and settle sharing',async({browser})=>{
  const {createStandaloneSignalingServer}=await import('../../server/reploid-signaling.js');
  const signaling=createStandaloneSignalingServer({port:0,env:{},swarmInferencePeer:null});
  await new Promise(resolve=>signaling.server.listen(0,'127.0.0.1',resolve));
  const port=signaling.server.address().port;
  const room='work-test-'+Date.now(), token='test-room-token-123456789012345678901234567890';
  const url=`http://localhost:8000/network?swarm=${room}&swarmToken=${token}&signaling=${encodeURIComponent('ws://127.0.0.1:'+port+'/signaling')}`;
  const providerContext=await browser.newContext(), requesterContext=await browser.newContext();
  const provider=await providerContext.newPage(),requester=await requesterContext.newPage();
  try{
    await provider.goto(url);await requester.goto(url);
    await provider.evaluate(async()=>{
      const {createWorkSwarm}=await import('/host/work-swarm.js');
      window.providerCalls=0;window.providerScopes=new Set();
      window.testSwarm=createWorkSwarm({storage:localStorage,service:{
        async open({scope}) {window.providerScopes.add(scope);await new Promise(resolve=>{window.releaseModel=resolve;});return {async *stream(){window.providerCalls++;await new Promise(resolve=>{window.releaseGeneration=resolve;});yield {type:'text-delta',text:'A peer checked the proposed approach.'};}};},
        async close(scope){window.providerScopes.delete(scope);}
      }});
      await window.testSwarm.share('qwen-3-5-2b-q4k-ef16-af32',true);
    });
    await requester.evaluate(async()=>{const {createWorkSwarm}=await import('/host/work-swarm.js');window.testSwarm=createWorkSwarm({storage:localStorage});await window.testSwarm.connect();});
    await expect.poll(()=>requester.evaluate(()=>window.testSwarm.getState().consumer?.providerCount),{timeout:15000}).toBeGreaterThan(0);
    expect(await requester.evaluate(()=>window.testSwarm.getState().consumer.transport)).toBe('webrtc');
    await requester.evaluate(()=>{
      window.peerEvents=[];window.pendingPeer=null;
      window.peerResult=window.testSwarm.execute({task:'Check this public approach.'},{signal:new AbortController().signal,
        record:async event=>window.peerEvents.push(event),approve:preview=>new Promise(resolve=>{window.pendingPeer=preview;window.decidePeer=resolve;})});
    });
    await expect.poll(()=>requester.evaluate(()=>!!window.pendingPeer)).toBe(true);
    expect(await provider.evaluate(()=>window.providerCalls)).toBe(0);
    await requester.evaluate(()=>window.decidePeer(true));
    await expect.poll(()=>provider.evaluate(()=>window.testSwarm.getState().contribution.phase)).toBe('loading');
    await provider.evaluate(()=>window.releaseModel());
    await expect.poll(()=>provider.evaluate(()=>window.testSwarm.getState().contribution.phase)).toBe('executing');
    await provider.evaluate(()=>window.releaseGeneration());
    const result=await requester.evaluate(()=>window.peerResult);
    await expect.poll(()=>provider.evaluate(()=>window.testSwarm.getState().contribution.completed)).toBe(1);
    expect(result.output).toBe('A peer checked the proposed approach.');
    expect(result.claim).toBe('legacy-compatibility-result');
    expect(await requester.evaluate(()=>window.peerEvents.map(e=>e.stage))).toEqual(['proposed','approved','completed']);
    expect(await provider.evaluate(()=>window.providerCalls)).toBe(1);
    await provider.evaluate(()=>window.testSwarm.stop());
    expect(await provider.evaluate(()=>window.providerScopes.size)).toBe(0);
  }finally{
    await provider.evaluate(()=>{window.releaseModel?.();window.releaseGeneration?.();}).catch(()=>{});
    await Promise.all([provider.evaluate(()=>window.testSwarm?.close()).catch(()=>{}),requester.evaluate(()=>window.testSwarm?.close()).catch(()=>{})]);
    await providerContext.close();await requesterContext.close();await signaling.close();
  }
});

test('quote extractor and isolated evaluator preserve correct results, exceptions and mutation observations', async ({ page }) => {
  await page.goto('/');
  const code = `function chooseQuote(quotes, budgetCents, deadline) {
    const eligible = quotes.map(q => ({ id:q.id, completionDate:q.completionDate,
      totalCents:q.taxIncluded ? q.subtotalCents : Math.round(q.subtotalCents * (1 + q.taxPercent / 100)) }))
      .filter(q => q.totalCents <= budgetCents && q.completionDate <= deadline)
      .sort((a,b) => a.totalCents - b.totalCents || a.id.localeCompare(b.id));
    return eligible.length ? { id:eligible[0].id, totalCents:eligible[0].totalCents } : null;
  }`;
  for (const answer of [code, '```javascript\n' + code + '\n```']) {
    expect(extractQuoteCode(answer).trim()).toBe(code);
    for (const sample of QUOTE_CASES) {
      const actual = await evaluateQuoteCode(page, extractQuoteCode(answer), {
        quotes:sample.quotes, budget:sample.budget, deadline:sample.deadline
      });
      expect(actual.exception).toBeNull(); expect(actual.value).toEqual(sample.expected);
      expect(actual.mutationPreserved).toBe(true);
      expect(actual.valueIsNull).toBe(sample.expected === null);
    }
  }
  const input = { quotes:[{id:'original'}], budget:0, deadline:'2026-06-01' };
  const mutation = await evaluateQuoteCode(page, 'function chooseQuote(quotes) { quotes[0].id = "changed"; return null; }', input);
  expect(mutation.mutationPreserved).toBe(false);
  const exception = await evaluateQuoteCode(page, 'function chooseQuote(quotes) { quotes[0].id = "changed"; throw new Error("candidate failed"); }', input);
  expect(exception.exception.message).toBe('candidate failed'); expect(exception.mutationPreserved).toBe(false);
  const nonfinite = await evaluateQuoteCode(page, 'function chooseQuote() { return NaN; }', input);
  expect(nonfinite.value).toBeNull(); // JSON transport normalizes NaN; it is not a null return.
  expect(nonfinite.resultType).toBe('number'); expect(nonfinite.valueIsNull).toBe(false);
  expect(input.quotes[0].id).toBe('original');
});

test('model file cache recovers when its directory disappears', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createWorkModelFiles } = await import('/host/work-model-files.js');
    const contents = { first: new Uint8Array([1, 2, 3]), second: new Uint8Array([4, 5, 6]) };
    const artifacts = {};
    for (const [name, bytes] of Object.entries(contents)) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      artifacts[name] = { path: name + '.bin', url: 'https://fixture.invalid/' + name,
        role: 'model-adapter', sizeBytes: bytes.length, hash: 'sha256:' + hash };
    }
    let reads = 0;
    const files = createWorkModelFiles({ getTransport: () => null, fetchImpl: async url => {
      reads++; return new Response(contents[new URL(url).pathname.slice(1)]);
    } });
    const controls = { signal: new AbortController().signal };
    try {
      await files.acquireAdapter(artifacts.first, controls);
      await files.acquireAdapter(artifacts.second, controls);
      await (await navigator.storage.getDirectory()).removeEntry('reploid-chat-artifacts-v1', { recursive: true });
      const acquired = await files.acquireAdapter(artifacts.first, controls);
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
      const saved = await (await folder.getFileHandle(artifacts.first.hash.replace(':', '-'))).getFile();
      return { acquired: Array.from(acquired), saved: Array.from(new Uint8Array(await saved.arrayBuffer())), reads };
    } finally { await files.close(); }
  });
  expect(result).toEqual({ acquired: [1, 2, 3], saved: [1, 2, 3], reads: 3 });
});
