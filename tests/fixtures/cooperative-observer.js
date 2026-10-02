import { readFile } from 'node:fs/promises';

/** Passive debugger observations: never replace tensors, assign roles, or open a runtime. */
export async function observeCooperativePage(cdp, evidence) {
  const host = (await readFile('self/host/work-partitions.js', 'utf8')).split('\n');
  const peer = (await readFile('self/vendor/reploid/mesh/partitions/partition-peer.js', 'utf8')).split('\n');
  await cdp.send('Debugger.enable');
  const opened = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/host/work-partitions\\.js$',
    lineNumber: host.findIndex(line => line.includes('return { runtime, model, plan')) });
  const step = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/mesh/partitions/partition-peer\\.js$',
    lineNumber: peer.findIndex(line => line.includes('const { logits: _logits')), condition: 'result.step < 2' });
  cdp.on('Debugger.paused', async event => {
    try {
      const load = event.hitBreakpoints.includes(opened.breakpointId);
      if (!load && (!event.hitBreakpoints.includes(step.breakpointId) || evidence.steps.length >= 4)) return;
      const expression = load
        ? '({descriptor:resident.getState().descriptor,acquisition:source.getReceipt()})'
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
    if (maxDifference > tolerance) throw Error(`Distributed logits differ by ${maxDifference}; tolerance ${tolerance}`);
    return { threadId: step.identity.threadId, step: step.step, tokenId: step.tokenId,
      stopReason: step.stopReason, length: logits.length, maxDifference, tolerance };
  });
}
