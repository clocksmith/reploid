import { test, expect } from '@playwright/test';
const evidenceDir = process.env.REPLOID_E2E_ARTIFACT_DIR || 'artifacts/network-home-2026-09-19';
import { readFile } from 'node:fs/promises';

const candidateCode = '({text}) => { let s = text.replace(/^\\uFEFF/, "").trim(); if(s.startsWith("```json\\n") && s.endsWith("\\n```")) s=s.slice(8,-4); return JSON.stringify(JSON.parse(s),null,2); }';

test('task uses a helper and approved peer, evaluates code, requires adoption, and restores the old version', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async candidateCode => {
    const {createWorkSession, DEFAULT_WORK_MODELS} = await import('/host/work-session.js');
    const {createWorkEvolution} = await import('/host/work-evolution.js');
    const {renderWorkSurface,bindWorkSurface} = await import('/ui/pool-home/work.js');
    let app;
    const evolution=createWorkEvolution({storage:localStorage,isBusy:()=>app?.getState().busy});
    const tool=(name,args={})=>'REPLOID/0\nTOOL: '+name+'\n'+Object.entries(args).map(([key,value])=>key+' <<ARG\n'+(typeof value==='string'?value:JSON.stringify(value))+'\nARG').join('\n');
    const result=(messages,name)=>{
      const marker='[TOOL '+name+' RESULT]\n';const found=[...messages].reverse().find(m=>m.content?.includes(marker));
      return found?JSON.parse(found.content.slice(found.content.indexOf(marker)+marker.length)):null;
    };
    window.peerDispatches=0;
    const swarm={async execute({task},controls){
      const preview={id:'peer-fixture',operation:'generate',modelId:'fixture-model',providerId:'fixture-peer',input:task,options:{},limits:{},expiresAt:Date.now()+30000};
      await controls.record({stage:'proposed',preview});
      if(!await controls.approve(preview)) throw new Error('Disclosure declined');
      controls.signal.throwIfAborted();window.peerDispatches++;
      await controls.record({stage:'completed',preview});return {output:'Preserve quoted fence strings.',claim:'legacy-compatibility-result'};
    }};
    app=createWorkSession({storage:localStorage,swarm,credentials:async()=>({'Authorization':'Bearer browser-fixture','X-Firebase-AppCheck':'browser-fixture'}),
      evolution,fetchImpl:async(_url,request)=>{
        const {messages,model}=JSON.parse(request.body);
        if(result(messages,'ProposeImprovement')) window.improvementFeedback=result(messages,'ProposeImprovement');
        let content;
        if(messages.some(m=>m.content?.includes('You are a bounded helper.'))) {
          content=result(messages,'ReportResult')?'REPLOID/0\nIDLE: Done.':tool('ReportResult',{text:'Strip only the outer fence and initial byte order mark; preserve values and reject invalid JSON.'});
        } else if(result(messages,'RecordOutcome')) content='REPLOID/0\nIDLE: Done.';
        else if(!result(messages,'ListTools')) content=tool('ListTools');
        else if(!result(messages,'AskHelper')) content=tool('AskHelper',{goal:'Inspect handling of fenced JSON and byte order marks'});
        else if(!result(messages,'AskPeer')) content=tool('AskPeer',{task:'Check public JSON formatter edge cases.'});
        else if(!result(messages,'ProposeImprovement')) content=tool('ProposeImprovement',{targetId:'FormatJson',code:candidateCode,
          reason:'Handle wrapped JSON without changing values',baselineGeneration:result(messages,'ListTools')[0].generationId});
        else content=tool('RecordOutcome',{text:'The tool candidate passed its protected checks. Your approval is still required.'});
        return new Response(JSON.stringify({content,model,provider:'gemini'}),{status:200,headers:{'Content-Type':'application/json'}});
      }});
    const root=document.createElement('main');root.className='pool-home';root.innerHTML=renderWorkSurface();document.body.replaceChildren(root);
    window.integratedWork={app,evolution,model:DEFAULT_WORK_MODELS.find(m=>m.provider==='gemini').id};
    bindWorkSurface(root,app,{evolution});
  },candidateCode);
  await page.locator('[data-work-goal]').fill('Improve the JSON tool without changing its valid outputs');
  await page.locator('[data-work-model]').selectOption(await page.evaluate(()=>window.integratedWork.model));
  await page.locator('[data-work-helpers]').check(); await page.locator('[data-work-improvement]').check();
  await page.locator('[data-work-peers]').check();
  await page.locator('[data-work-start]').click();
  await expect(page.locator('[data-work-approval-payload]')).toContainText('Check public JSON formatter edge cases.');
  expect(await page.evaluate(()=>window.peerDispatches)).toBe(0);
  await expect(page.locator('[data-work-send]')).toBeDisabled();
  await page.locator('[data-work-public]').check();await page.locator('[data-work-send]').click();
  await expect(page.locator('[data-work-answer]')).toContainText('Your approval is still required');
  expect(await page.evaluate(()=>window.peerDispatches)).toBe(1);
  await expect(page.locator('[data-work-team]')).toContainText('completed');
  await expect(page.locator('[data-work-candidates]')).toContainText('Current: 4/6 checks. Candidate: 6/6 checks.');
  expect((await page.evaluate(()=>window.integratedWork.evolution.describe()))[0].generationId).toBe('FormatJson:genesis');
  const feedback = await page.evaluate(() => window.improvementFeedback);
  expect(feedback.evaluation.improvementKind).toBe('correctness');
  expect(feedback.evaluation.latency.observations).toBeUndefined();
  expect(await page.evaluate(async () => (await window.integratedWork.evolution.list())[0].evaluation.latency.observations.length)).toBe(12);
  await page.screenshot({path:`${evidenceDir}/candidate-review.png`,fullPage:true});
  await page.locator('[data-candidate-adopt]').click();
  await expect(page.locator('[data-work-candidates]')).toContainText('Adopted on this device');
  expect(await page.evaluate(()=>window.integratedWork.evolution.run('FormatJson',{text:'```json\n{"a":2}\n```'}))).toBe('{\n  "a": 2\n}');
  await page.reload();
  const restored=await page.evaluate(async()=>{
    const {createWorkEvolution}=await import('/host/work-evolution.js');
    window.restoredEvolution=createWorkEvolution({storage:localStorage,isBusy:()=>false});
    return window.restoredEvolution.list();
  });
  expect(restored[0].status).toBe('adopted');
  await page.evaluate(id=>window.restoredEvolution.rollback(id),restored[0].id);
  expect((await page.evaluate(()=>window.restoredEvolution.describe()))[0].generationId).toBe('FormatJson:genesis');
});

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
  const paths=['self/host/work-session.js','self/host/work-helpers.js','self/host/work-swarm.js','self/host/work-evolution.js',
    'self/infrastructure/code-sandbox.js','self/ui/pool-home/work-capabilities.js','self/ui/pool-home/work.js','self/ui/pool-home/index.js',
    'self/ui/pool-home/view.js','self/host/work-view.js','packages/reploid/src/improvement/code-evolution.js'];
  const snapshot=Object.fromEntries(await Promise.all(paths.map(async path=>[path.replace(/^self/,''),await readFile(path,'utf8')])));
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
    const model = DEFAULT_WORK_MODELS.find(item => item.provider === 'gemini');
    const app = createWorkSession({ storage: localStorage,
      credentials: async () => ({ Authorization: 'Bearer fixture', 'X-Firebase-AppCheck': 'fixture' }),
      fetchImpl: () => { window.recoveryFixture.entered = true; return borrowed; } });
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
      await window.testSwarm.share('qwen-3-5-2b-q4k-ehaf16',true);
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
