/** Training lifecycle only. Doppler owns sample identities, gradients and optimizer state. */
const assert = (value, message) => { if (!value) throw new Error(message); };
const copy = value => structuredClone(value);

export function createTrainingSession({ policy, participantId, openExecutor, connectPeer, openNetwork, onChange = () => {} }) {
  policy = copy(policy);
  let state = { phase: 'idle', message: '', completedSteps: 0, candidate: null };
  let active = null, executor = null, releasing = null, network = null, grant = null, closed = false, grantTimer = null, candidate = null;
  const listeners = new Set();
  const getState = () => ({ ...copy(state), busy: !!active || !!grant });
  const update = changes => { state = { ...state, ...changes }; onChange(getState()); for (const listener of listeners) listener(getState()); };
  const samplesWithinBounds = samples => {
    assert(Array.isArray(samples) && samples.length > 0 && samples.length <= policy.maxSamples, 'Training sample count exceeds the allowance');
    assert(new TextEncoder().encode(JSON.stringify(samples)).length <= policy.maxInputBytes, 'Training data exceeds the allowance');
    for (const sample of samples) {
      assert(Array.isArray(sample.inputIds) && Array.isArray(sample.targetIds)
        && sample.inputIds.length > 0 && sample.inputIds.length <= policy.maxTokensPerSample
        && sample.targetIds.length === sample.inputIds.length, 'Choose aligned, bounded tokenized training samples');
      assert(sample.inputIds.every(id => Number.isSafeInteger(id) && id >= 0 && id < policy.vocabSize)
        && sample.targetIds.every(id => Number.isSafeInteger(id) && (id === -100 || id === -1 || (id >= 0 && id < policy.vocabSize)))
        && Number.isSafeInteger(sample.supervisedTokenCount) && sample.supervisedTokenCount > 0
        && sample.supervisedTokenCount === sample.targetIds.filter(id => id >= 0).length, 'Training token IDs or supervised count are invalid');
    }
  };
  const current = signal => { signal.throwIfAborted(); assert(!closed, 'Training is closed'); };
  const call = async (action, input, signal) => {
    current(signal);
    const result = await executor.request(action, copy(input), { signal });
    current(signal); return result;
  };
  const release = () => {
    if (!executor) return Promise.resolve();
    return releasing ||= Promise.resolve().then(() => executor.close())
      .then(() => { executor = null; }).finally(() => { releasing = null; });
  };
  const begin = (phase, operation) => {
    assert(!closed && !active && !grant && !executor, 'Stop the current training activity first');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Training deadline reached; waiting for GPU work to settle')), policy.timeoutMs);
    const record = { controller, promise: null }; active = record;
    candidate = null; update({ phase, message: '', candidate: null, completedSteps: 0 });
    record.promise = Promise.resolve().then(() => operation(controller.signal)).catch(error => {
      const cancelled = controller.signal.aborted; controller.abort(error);
      update({ phase: cancelled ? 'cancelled' : 'failed', message: String(error?.message || error) });
      throw error;
    }).finally(async () => {
      clearTimeout(timer);
      try { if (!grant) await release(); }
      catch (error) { update({ phase: 'failed', message: `Training cleanup failed: ${error.message}` }); throw error; }
      finally { active = null; update({}); }
    });
    return record.promise;
  };
  const prepare = async (sample, identity, signal) => {
    executor = await openExecutor({ signal, onProgress: message => update({ message }) });
    current(signal);
    const result = await call('prepare', { sample, participantId: identity }, signal);
    assert(result.baseManifestHash === policy.baseManifestHash && result.assignment.participantId === identity,
      'Training model or participant differs from the approved configuration');
    return result.assignment;
  };
  const receive = async ({ action, jobId, body, remoteParticipantId, signal }) => {
    const accepted = grant;
    assert(accepted && accepted.coordinatorId === remoteParticipantId && !active && Date.now() < accepted.expiresAt,
      'Training contribution is not authorized or is busy');
    assert(typeof jobId === 'string' && jobId.length > 0 && jobId.length <= 128, 'Invalid training job identity');
    assert(!accepted.jobId || accepted.jobId === jobId, 'This contribution grant is bound to another job');
    accepted.jobId = jobId;
    if (action === 'describe') return { assignment: copy(accepted.assignment), baseManifestHash: policy.baseManifestHash };
    assert(action === 'contribute' && !accepted.consumed, 'Training contribution was already used');
    assert(body?.round?.jobId === jobId && body.round.baseManifestHash === policy.baseManifestHash,
      'Training round differs from this grant');
    const assigned = body.round.assignments?.find(row => row.participantId === accepted.assignment.participantId);
    assert(assigned?.sampleHash === accepted.assignment.sampleHash
      && assigned.supervisedTokenCount === accepted.assignment.supervisedTokenCount, 'Training round changed the approved sample');
    accepted.consumed = true;
    const controller = new AbortController(), abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const record = { controller, promise: null }; active = record;
    update({ phase: 'contributing', message: 'Computing this participant’s gradient' });
    record.promise = call('contribute', { round: body.round, participantId: accepted.assignment.participantId, sample: accepted.sample }, controller.signal)
      .then(result => {
        assert(grant === accepted, 'Training contribution permission changed');
        update({ phase: 'contributed', message: 'Gradient returned; no adapter was activated' }); return result;
      }).catch(error => { update({ phase: 'failed', message: error.message }); throw error; })
      .finally(async () => { signal.removeEventListener('abort', abort); try { await release(); } finally { active = null; update({}); } });
    return record.promise;
  };
  const ensureNetwork = () => network ||= openNetwork({ receive, allowed: remote => grant?.coordinatorId === remote && Date.now() < grant.expiresAt });
  return Object.freeze({
    getState,
    getCandidate: () => candidate && copy(candidate),
    async connect() {
      assert(!closed && !active && !grant, 'Stop the current training activity first');
      await participantId(true);
      assert(!closed && !active && !grant, 'Stop the current training activity first');
      await network?.close(); network = null; ensureNetwork();
    },
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    async run(input) {
      input = copy(input);
      assert(input.consent === true, 'Approve training on the selected data first');
      samplesWithinBounds(input.samples);
      const peers = input.peers || [];
      assert(Array.isArray(peers) && peers.length < policy.maxParticipants && new Set(peers).size === peers.length, 'Choose distinct bounded participants');
      assert(input.adapter && /^[a-zA-Z0-9._-]{1,96}$/.test(input.adapter.id)
        && typeof input.adapter.name === 'string' && input.adapter.name.length <= 128
        && /^\d+\.\d+\.\d+$/.test(input.adapter.version), 'Choose an adapter ID, name and semantic version');
      if (peers.length) assert(input.samples.length === 1, 'A pooled round uses one local sample per participant');
      return begin('preparing', async signal => {
        const identity = await participantId(peers.length > 0);
        current(signal);
        const ownAssignment = await prepare(input.samples[0], identity, signal);
        let metrics, provenance = { mode: peers.length ? 'pooled' : 'individual', participants: [identity], evaluated: false, activated: false };
        if (peers.length) {
          ensureNetwork();
          const jobId = crypto.randomUUID();
          const selected = await Promise.all(peers.map(peer => connectPeer(network, peer, signal)));
          current(signal);
          assert(new Set([identity, ...selected.map(peer => peer.participantId)]).size === selected.length + 1, 'Participants resolve to duplicate identities');
          const descriptions = await Promise.all(selected.map(peer => peer.request('describe', jobId, {}, signal)));
          descriptions.forEach((row, index) => assert(row.baseManifestHash === policy.baseManifestHash
            && row.assignment?.participantId === selected[index].participantId, 'Contributor model or identity changed'));
          const round = await call('round', { jobId, roundId: '0', assignments: [ownAssignment, ...descriptions.map(row => row.assignment)] }, signal);
          provenance = { ...provenance, trainingRoundHash: round.roundHash, parentCheckpointHash: round.checkpointHash, participants: round.assignments.map(row => row.participantId) };
          update({ phase: 'training', message: `Collecting ${selected.length + 1} gradient contributions` });
          const operations = [call('contribute', { round, participantId: identity, sample: input.samples[0] }, signal),
            ...selected.map(peer => peer.request('contribute', jobId, { round }, signal))];
          // A failed contribution cannot cause a partial optimizer update or automatic replay.
          const outcomes = await Promise.allSettled(operations);
          current(signal);
          const failure = outcomes.find(row => row.status === 'rejected');
          if (failure) throw failure.reason;
          update({ phase: 'applying', message: 'Applying one shared optimizer update' });
          metrics = [await call('apply', { round, contributions: outcomes.map(row => row.value) }, signal)];
          update({ completedSteps: 1 });
        } else {
          metrics = [];
          for (const sample of input.samples) {
            update({ phase: 'training', message: `Training sample ${metrics.length + 1} of ${input.samples.length}` });
            metrics.push(await call('step', { sample }, signal)); update({ completedSteps: metrics.length });
          }
        }
        const exported = await call('export', { ...input.adapter, weightsPath: 'adapter.safetensors', metadata: provenance }, signal);
        assert(exported.weights instanceof ArrayBuffer && exported.weightsSha256, 'Doppler returned no verified adapter weights');
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', exported.weights))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        current(signal);
        assert(digest === exported.weightsSha256 && exported.manifest.checksum === digest, 'Exported adapter checksum mismatch');
        candidate = { ...exported, metrics, evaluated: false, activated: false };
        update({ phase: 'completed', message: 'Adapter exported. Task quality and activation require separate review.',
          candidate: { id: exported.manifest.id, version: exported.manifest.version, weightsSha256: exported.weightsSha256 } });
        return copy(candidate);
      });
    },
    async contribute(input) {
      input = copy(input);
      assert(input.consent === true, 'Approve releasing gradients to this coordinator first');
      samplesWithinBounds([input.sample]);
      return begin('preparing', async signal => {
        const identity = await participantId(true); current(signal); ensureNetwork();
        const coordinator = await connectPeer(network, input.coordinator, signal); current(signal);
        assert(coordinator.participantId !== identity, 'Choose another coordinator');
        const assignment = await prepare(input.sample, identity, signal);
        grant = { coordinatorId: coordinator.participantId, assignment, sample: input.sample, jobId: null,
          consumed: false, expiresAt: Date.now() + policy.timeoutMs };
        grantTimer = setTimeout(() => { this.stop().catch(error => update({ phase: 'failed', message: error.message })); }, policy.timeoutMs);
        update({ phase: 'ready', message: 'Ready for one round from the selected coordinator' });
      });
    },
    async stop() {
      grant = null; clearTimeout(grantTimer); grantTimer = null;
      if (active) {
        update({ phase: 'stopping', message: 'Stopping after the current GPU operation settles' });
        active.controller.abort(new Error('Training stopped'));
        await active.promise.catch(() => {});
      }
      await release(); update({ phase: 'idle', message: 'Training stopped' });
    },
    async close() {
      closed = true; await this.disconnect(); listeners.clear();
    },
    async disconnect() {
      await this.stop(); await network?.close(); network = null;
    }
  });
}
