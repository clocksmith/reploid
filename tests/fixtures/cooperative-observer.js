import { readFile } from 'node:fs/promises';

/** Passive debugger observations: never replace tensors, assign roles, or open a runtime. */
export async function observeCooperativePage(cdp, evidence, { captureCustody = false, captureLogits = true, captureTokens = false, maxLogitSteps = 4, acceptStep = async () => true, onInput = null } = {}) {
  const host = (await readFile('self/host/work-partitions.js', 'utf8')).split('\n');
  const peer = (await readFile('self/vendor/reploid/mesh/partitions/partition-peer.js', 'utf8')).split('\n');
  const scriptUrls = new Map();
  cdp.on('Debugger.scriptParsed', event => scriptUrls.set(event.scriptId, event.url));
  await cdp.send('Debugger.enable');
  // Initial loading legitimately misses thousands of checkpoint chunks.
  // Trace exceptions after readiness, at the recovery boundary under study.
  await cdp.send('Debugger.setPauseOnExceptions', { state: captureCustody ? 'none' : 'all' });
  const opened = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/host/work-partitions\\.js$',
    lineNumber: host.findIndex(line => line.includes('return { runtime, model, plan')) });
  let step = captureLogits && await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/mesh/partitions/partition-peer\\.js$',
    lineNumber: peer.findIndex(line => line.includes('const { logits: _logits')), condition: `result.step < ${maxLogitSteps}` });
  const custody = new Map();
  const automatic = (await readFile('self/vendor/reploid/mesh/partitions/automatic-partitions.js', 'utf8')).split('\n');
  const identityBoundary = automatic.findIndex(line => line.includes('const config = structuredClone(policy)'));
  if (identityBoundary < 0) throw Error('Partition identity observation boundary missing');
  const identityProbe = await cdp.send('Debugger.setBreakpointByUrl', {
    urlRegex: '/mesh/partitions/automatic-partitions\\.js$', lineNumber: identityBoundary });
  custody.set(identityProbe.breakpointId, { kind: 'participant-identity', target: 'lifecycle', expression: '({participantId:identity.peerId})' });
  let fileProbesInstalled = false;
  const installFileProbes = async () => {
    if (fileProbesInstalled) return;
    const sources = [
      { file: 'self/host/work-model-files.js', urlRegex: '/host/work-model-files\\.js$', probes: [
        { kind: 'cache-read', marker: 'const handle = await (await root()).getFileHandle(fileKey(file));', expression: '({file, key:fileKey(file), directory:directory?.name, activePieces, operations:operations.size, retainedPieces:retainedPieces.size, pinned:pinned.size, sharing:exchange?.getState().sharing})' },
        { kind: 'cache-handle', marker: 'const blob = await handle.getFile();', condition: 'file.role !== "model-weights"', expression: '({file,key:fileKey(file),name:handle.name})' },
        { kind: 'cache-blob', marker: "assert(blob.size === file.sizeBytes, 'Cached model file size mismatch');", condition: 'file.role !== "model-weights"', expression: '({file,key:fileKey(file),name:blob.name,size:blob.size,lastModified:blob.lastModified})' },
        { kind: 'cache-miss', marker: "} catch (cause) { if (cause.name === 'NotFoundError') return null; throw cause; }", expression: '({file, error:{name:cause.name,message:cause.message,stack:cause.stack}})' },
        { kind: 'cache-enumerate', marker: 'const stored = await handle.getFile(); used += stored.size;', condition: 'file.role !== "model-weights"', expression: '({file,key,name,used})' }
      ] },
      { file: 'self/infrastructure/pack-transfer-storage.js', urlRegex: '/infrastructure/pack-transfer-storage\\.js$', probes: [
        { kind: 'staging-read', marker: "try { return JSON.parse(await (await (await directory.getFileHandle('index.json')).getFile()).text()); }", expression: '({directory:directory.name,closed})' }
      ] },
      { file: 'self/vendor/reploid/mesh/partitions/automatic-partitions.js', urlRegex: '/mesh/partitions/automatic-partitions\\.js$', probes: [
        { kind: 'load-failed', marker: "catch (cause) { phase = 'failed'; error = cause.message; notify(); throw cause; }", expression: '({placement,model:selectedOffer.id,error:{name:cause.name,message:cause.message,stack:cause.stack}})' },
        { kind: 'retire', marker: 'const owners = [chat, execution, program?.resident];', target: 'lifecycle', expression: '({phase,placement,preparing:!!preparing,admissions:admissions.size,resident:program?.resident.getState(),approved:!!offer,aborted:contributionController?.signal.aborted})' },
        { kind: 'advertise-ready', marker: "phase = 'ready'; progress = null; notify();", target: 'lifecycle', expression: '({phase,placement,resident:program?.resident.getState(),approved:!!offer,aborted:contributionController?.signal.aborted})' }
      ] }
    ];
    for (const source of sources) {
      const lines = (await readFile(source.file, 'utf8')).split('\n');
      for (const probe of source.probes) {
        const lineNumber = lines.findIndex(line => line.includes(probe.marker));
        if (lineNumber < 0) throw Error('File observation boundary missing: ' + probe.kind);
        const breakpoint = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: source.urlRegex, lineNumber, condition: probe.condition || '' });
        custody.set(breakpoint.breakpointId, { ...probe, target: probe.target || 'files' });
      }
    }
    fileProbesInstalled = true;
    await cdp.send('Debugger.setPauseOnExceptions', { state: 'all' });
  };
  if (captureCustody) {
    const chat = (await readFile('self/vendor/reploid/mesh/partitions/partition-chat.js', 'utf8')).split('\n');
    const inputBoundary = chat.findIndex(line => line.includes('grant = await authority.issue(identity, policy'));
    if (inputBoundary < 0) throw Error('Partition input observation boundary missing');
    const inputProbe = await cdp.send('Debugger.setBreakpointByUrl', {
      urlRegex: '/mesh/partitions/partition-chat\\.js$', lineNumber: inputBoundary,
      condition: 'request.messages.at(-1).content.includes("chooseQuote")' });
    custody.set(inputProbe.breakpointId, { kind: 'input-tokenized', target: 'inputs',
      expression: '({identity,messages:request.messages,modelIdentity:input.modelIdentity,tokenIds:Array.from(input.tokenIds),generation:input.generation})' });
    const source = (await readFile('self/vendor/reploid/artifacts/custody/exchange.js', 'utf8')).split('\n');
    const probes = [
      { kind: 'offer-received', marker: 'const first = !peers.has(peer);',
        expression: '({peer, artifacts:message.artifacts, connected:[...connected()]})' },
      { kind: 'missing-source', marker: 'return [...peers.entries()].filter',
        condition: 'artifact.path.startsWith("shard_") && ![...peers.values()].some(files => files.some(item => key(item) === key(artifact)))',
        expression: '({artifact, connected:[...ids], inventories:[...peers].map(([peer, files]) => ({peer, artifacts:files}))})' },
      { kind: 'supply-stopped', marker: 'supply = false; supplyEpoch++;',
        expression: '({supply, supplyEpoch, offered, reserved, preparing})' },
      { kind: 'supply-failed', marker: "if (!closed) transport.sendToPeer(peer, 'reploid:custody-response', { id: message?.id, error: error.message });",
        expression: '({peer, artifact:message?.artifact, range:message?.range, error:{name:error.name,message:error.message,stack:error.stack}})' }
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
        const target = probe.target || 'custody';
        evidence[target] ||= [];
        evidence[target].push({ kind: probe.kind, observedAt: Date.now(), ...result.result.value });
        if (probe.kind === 'participant-identity') evidence.participantId = result.result.value.participantId;
        if (probe.kind === 'input-tokenized') await onInput?.(result.result.value);
        if (evidence[target].length > (target === 'files' ? 64 : 512)) evidence[target].shift();
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
        const exception = {
          description: event.data?.description, denied,
          frames: event.callFrames.slice(0, 6).map(frame => ({ functionName: frame.functionName,
            url: frame.url || scriptUrls.get(frame.location.scriptId), location: frame.location }))
        };
        if (event.data?.description?.includes('NotFoundError')) {
          evidence.missingFiles ||= [];
          evidence.missingFiles.push(exception);
          if (evidence.missingFiles.length > 128) evidence.missingFiles.shift();
        } else if (evidence.exceptions.length < 100) evidence.exceptions.push(exception);
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
        : captureLogits ? '({identity:result.identity,step:result.step,tokenId:result.tokenId,done:result.done,stopReason:result.stopReason,logits:Array.from(result.logits)})'
          : '({identity:result.identity,step:result.step,tokenId:result.tokenId,done:result.done,stopReason:result.stopReason})';
      const result = await cdp.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId,
        expression, returnByValue: true });
      if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
      if (load) {
        evidence.loads.push(result.result.value);
        // Record local file boundaries only after initial acquisition; normal
        // cache misses during first loading are not the rejoin failure.
        if (captureCustody && !fileProbesInstalled) await installFileProbes();
      } else evidence.steps.push(result.result.value);
    } catch (error) { evidence.errors.push(error.message); }
    finally { await cdp.send('Debugger.resume').catch(() => {}); }
  });
  return { armFileProbes: installFileProbes,
    async captureAttempt(attemptId) {
      if (!captureTokens || captureLogits) return;
      if (step) await cdp.send('Debugger.removeBreakpoint', { breakpointId: step.breakpointId });
      step = await cdp.send('Debugger.setBreakpointByUrl', { urlRegex: '/mesh/partitions/partition-peer\\.js$',
        lineNumber: peer.findIndex(line => line.includes('const { logits: _logits')),
        condition: `result.step < ${maxLogitSteps} && result.identity.attemptId === ${JSON.stringify(attemptId)}` });
    }
  };
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
