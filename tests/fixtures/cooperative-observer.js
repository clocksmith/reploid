import { readFile } from 'node:fs/promises';

/** Passive debugger observations: never replace tensors, assign roles, or open a runtime. */
export async function observeCooperativePage(cdp, evidence, { captureCustody = false, captureLogits = true, maxLogitSteps = 4, acceptStep = async () => true } = {}) {
  const host = (await readFile('self/host/work-partitions.js', 'utf8')).split('\n');
  const peer = (await readFile('self/vendor/reploid/mesh/partitions/partition-peer.js', 'utf8')).split('\n');
  await cdp.send('Debugger.enable');
  await cdp.send('Debugger.setPauseOnExceptions', { state: 'all' });
  const opened = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/host/work-partitions\\.js$',
    lineNumber: host.findIndex(line => line.includes('return { runtime, model, plan')) });
  const step = captureLogits && await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/mesh/partitions/partition-peer\\.js$',
    lineNumber: peer.findIndex(line => line.includes('const { logits: _logits')), condition: `result.step < ${maxLogitSteps}` });
  const custody = new Map();
  if (captureCustody) {
    const source = (await readFile('self/vendor/reploid/artifacts/custody/exchange.js', 'utf8')).split('\n');
    const probes = [
      { kind: 'offer-received', marker: 'const first = !peers.has(peer);',
        expression: '({peer, artifacts:message.artifacts, connected:[...connected()]})' },
      { kind: 'missing-source', marker: 'return [...peers.entries()].filter',
        condition: 'artifact.path.startsWith("shard_") && ![...peers.values()].some(files => files.some(item => key(item) === key(artifact)))',
        expression: '({artifact, connected:[...ids], inventories:[...peers].map(([peer, files]) => ({peer, artifacts:files}))})' },
      { kind: 'supply-stopped', marker: 'supply = false; supplyEpoch++;',
        expression: '({supply, supplyEpoch, offered, reserved, preparing})' }
    ];
    for (const probe of probes) {
      const lineNumber = source.findIndex(line => line.includes(probe.marker));
      if (lineNumber < 0) throw Error('Custody observation boundary missing: ' + probe.kind);
      const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
        urlRegex: '/artifacts/custody/exchange\\.js$', lineNumber, condition: probe.condition || '' });
      custody.set(breakpoint.breakpointId, probe);
    }
  }
  cdp.on('Debugger.paused', async event => {
    try {
      const probe = event.hitBreakpoints?.map(id => custody.get(id)).find(Boolean);
      if (probe) {
        const result = await cdp.send('Debugger.evaluateOnCallFrame', {
          callFrameId: event.callFrames[0].callFrameId, expression: probe.expression, returnByValue: true });
        if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
        evidence.custody ||= [];
        evidence.custody.push({ kind: probe.kind, observedAt: Date.now(), ...result.result.value });
        if (evidence.custody.length > 512) evidence.custody.shift();
        return;
      }
      if (['exception', 'promiseRejection'].includes(event.reason)) {
        evidence.exceptions ||= [];
        const authorization = event.callFrames.find(frame => frame.functionName === 'permit');
        let denied = null;
        if (authorization && event.data?.description?.includes('authorization declined')) {
          const inspected = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: authorization.callFrameId,
            expression: `({ action, now: Date.now(), operation: entry.metadata.operation,
              identity: entry.metadata.identity, step: entry.metadata.step, inputTokenCount: entry.metadata.inputTokenCount,
              maxTokens: entry.metadata.maxTokens, generationDigest: entry.metadata.generationDigest,
              frame: entry.metadata.frame, grantClaim: entry.metadata.grant?.claim })`, returnByValue: true });
          denied = inspected.result?.value ?? null;
        }
        if (!event.data?.description?.includes('NotFoundError') && evidence.exceptions.length < 100) evidence.exceptions.push({
          description: event.data?.description, denied,
          frames: event.callFrames.slice(0, 6).map(frame => ({ functionName: frame.functionName, url: frame.url, location: frame.location }))
        });
        return;
      }
      const load = event.hitBreakpoints.includes(opened.breakpointId);
      if (!load && (!step || !event.hitBreakpoints.includes(step.breakpointId) || evidence.steps.length >= maxLogitSteps)) return;
      if (!load) {
        const identity = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
          expression: 'result.identity', returnByValue: true });
        if (!await acceptStep(identity.result.value)) return;
      }
      const expression = load
        ? '({descriptor:resident.getState().descriptor,acquisition:source.getReceipt(),preparation,memory:runtime.inspectDeviceMemory()})'
        : '({identity:result.identity,step:result.step,tokenId:result.tokenId,done:result.done,stopReason:result.stopReason,logits:Array.from(result.logits)})';
      const result = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
        expression, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
      if (load) evidence.loads.push(result.result.value); else evidence.steps.push(result.result.value);
    } catch (error) { evidence.errors.push(error.message); }
    finally { await cdp.send('Debugger.resume').catch(() => {}); }
  });
}

export function compareObservedLogits(observations, history, reference, tolerance) {
  return observations.flatMap(device => device.steps).map(step => {
    const thread = history.threads.find(thread => thread.id === step.identity.threadId);
    const prompt = thread.messages[0].content;
    const index = reference.prompts.findIndex(messages => messages.at(-1).content === prompt);
    if (index < 0) throw Error('Observed prompt has no exact numerical reference');
    const expected = reference.expected[index].steps[step.step];
    const bytes = Buffer.from(expected.logits, 'base64');
    const logits = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    if (logits.length !== step.logits.length || expected.tokenId !== step.tokenId || expected.stopReason !== step.stopReason) {
      throw Error('Distributed output shape, sampled token, or stopping differs from the reference');
    }
    let maxDifference = 0;
    for (let i = 0; i < logits.length; i++) {
      if (!Number.isFinite(step.logits[i])) throw Error('Nonfinite distributed logits');
      maxDifference = Math.max(maxDifference, Math.abs(logits[i] - step.logits[i]));
    }
    return { threadId: step.identity.threadId, step: step.step, tokenId: step.tokenId,
      stopReason: step.stopReason, length: logits.length, maxDifference, tolerance,
      matches: maxDifference <= tolerance };
  });
}
