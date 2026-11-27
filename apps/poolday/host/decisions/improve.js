/**
 * The Changes page (/improve) without markup: past attempts and the selected one's result, tool updates with their
 * local evaluations and the explicit tool-offer handoff, and LoRA adapter training. It is the vanilla page's
 * binding (ui/pool-home/work.js renderImproveSurface + bindWorkSurface, work-capabilities.js, work-tool-offers.js,
 * lora-training.js) with the DOM taken out, so every line it shows and every check it makes is the one the vanilla
 * page made. The work session, evolution, swarm and training owners (host/) decide and record everything; this
 * owns only what the person has staged on the page.
 */
import { deriveOutcomeTags } from '../work-session.js';
import { answerPrivacy } from '../../ui/pool-home/privacy-controls.js';

const CANDIDATE_STATE = { evaluating: 'Testing', 'awaiting-approval': 'Tested · approval needed', adopted: 'Adopted on this device',
  rejected: 'Not adopted', 'rolled-back': 'Reverted', failed: 'Test failed', cancelled: 'Testing stopped' };
const candidateState = item => CANDIDATE_STATE[item.status] || item.status;
const capitalize = value => String(value || '').replace(/^./, character => character.toUpperCase());

/** Downloads are the page's to perform; each command that produces one returns { name, text, type }. */
export function createImproveController({ work = null, evolution = null, swarm = null, training = null, now = () => Date.now() } = {}) {
  const listeners = new Set();
  let disposed = false, snapshot = null;
  let workState = work?.getState?.() ?? null;
  let error = '', experimentStatus = '', inspectionOpen = false;
  let candidates = [], active = [], candidatesLoaded = false, candidatesFailed = false;
  let candidateRevision = 0, candidateBusy = new Set();
  // Tool offers: the reviewed file or peer offer, and what each candidate is set to send to.
  let offer = { selection: 0, pending: null, evaluating: false };
  const peerChoice = new Map();
  // Training: the chosen samples and the form.
  let trainingState = training?.getState?.() ?? null, exported = training?.getCandidate?.() ?? null;
  let lora = { samples: null, reading: false, revision: 0, adapterId: 'my-qwen-adapter', version: '0.0.1', consent: false,
    coordinator: '', peers: [], selected: [], error: '', status: '', downloads: !!exported };

  const notify = () => { if (disposed) return; snapshot = project(); for (const listener of listeners) listener(); };
  const fail = cause => { error = String(cause?.message || cause || ''); notify(); };
  const act = operation => Promise.resolve().then(operation).catch(fail);

  const refreshCandidates = async () => {
    if (!evolution) return;
    const current = ++candidateRevision;
    try {
      const [list, described] = await Promise.all([evolution.list(), evolution.describe()]);
      if (disposed || current !== candidateRevision) return;
      candidates = list; active = described; candidatesLoaded = true; candidatesFailed = false;
    } catch (cause) {
      if (disposed || current !== candidateRevision) return;
      candidatesFailed = true; experimentStatus = cause.message;
    }
    notify();
  };

  function projectRecord(row, state) {
    if (!row) return null;
    const tags = row.outcomeTags || deriveOutcomeTags(row);
    const parent = state.records.find(item => item.id === row.parentId);
    let reviewStatus = '';
    if (row.output) {
      if (!row.review) reviewStatus = 'Needs your review';
      else reviewStatus = row.review.accepted ? 'Accepted by you' : 'Changes requested';
    }
    return {
      id: row.id,
      title: row.output ? 'Results' : '',
      tags,
      reviewStatus,
      answer: row.output || (state.busy || row.error ? '' : 'No result.'),
      error: row.error || '',
      artifacts: (row.artifacts || []).map(artifact => ({ id: artifact.id, label: 'Download ' + artifact.name,
        meta: artifact.bytes + ' bytes / ' + (artifact.inspection ? artifact.inspection.checks.map(check => check.name + ': ' + (check.passed ? 'pass' : 'fail')).join(', ') : 'not inspected'),
        title: artifact.inspection ? artifact.inspection.scope + ' SHA-256: ' + artifact.inspection.sha256 : '' })),
      progress: {
        visible: !!(row.events?.length || row.helpers?.length || row.peerJobs?.length || row.peerSteps?.length || state.draft),
        open: !!state.busy || !!row.events?.some(event => event.error) || !!row.helpers?.some(helper => helper.error),
        team: [
          ...(row.helpers || []).map(helper => ({ text: 'Helper · ' + helper.location + ' · ' + helper.status + ': ' + helper.goal + (helper.error ? ' — ' + helper.error : ''), title: '' })),
          // Each Reploid peer step's execution receipt: who could read it, and only what this browser checked.
          ...(row.peerSteps || []).map(step => { const [summary, detail] = answerPrivacy({ receipt: step.receipt });
            return { text: 'Peer step · ' + step.receipt.status + ' · ' + summary, title: detail }; }),
          ...(row.peerJobs || []).map(job => ({ text: 'Peer · ' + job.stage + ' · ' + (job.preview?.modelId || '') + ' · ' + (job.preview?.providerId || '').slice(0, 16), title: '' }))
        ],
        events: (row.events || []).map(event => event.tool + ' / ' + event.status + (event.error ? ': ' + event.error : '')),
        draft: state.draft || ''
      },
      reviewActions: row.output ? { disabled: !!state.busy } : null,
      criteria: row.criteria ? 'Success criteria: ' + row.criteria : '',
      audit: [`Attempt ID: ${row.id} | Model: ${row.modelName} (${row.modelId})`,
        ...(row.artifacts || []).filter(artifact => artifact.inspection?.sha256).map(artifact => artifact.name + ' SHA-256: ' + artifact.inspection.sha256)],
      comparison: parent ? { output: parent.output || parent.error || 'No outcome was delivered.', feedback: row.feedback ? 'Requested change: ' + row.feedback : '' } : null
    };
  }

  function projectTools(state) {
    if (!evolution) return null;
    const swarmState = swarm?.getState?.() ?? null, offers = swarmState?.offers;
    const busy = !!state?.anyBusy, peers = offers?.peers || [];
    const rows = [...candidates].reverse().map(item => {
      const evaluation = item.evaluation, latency = evaluation?.latency;
      const origin = state?.records.find(row => row.improvements?.some(change => change.id === item.id));
      let improvementNote = 'No qualifying improvement.';
      if (evaluation?.improvementKind === 'latency') improvementNote = 'Qualifying latency improvement.';
      else if (evaluation?.improvementKind === 'correctness') improvementNote = 'Qualified by correctness repair.';
      return {
        id: item.id, targetId: item.targetId, state: candidateState(item), reason: item.reason, imported: !!item.origin,
        origin: origin ? { id: origin.id, label: 'From task: ' + origin.goal } : null,
        checks: evaluation ? `Current: ${evaluation.baselinePassed}/${evaluation.total} checks. Candidate: ${evaluation.candidatePassed}/${evaluation.total} checks.` : '',
        latency: latency ? {
          summary: 'Current: ' + latency.baselineMedianMs.toFixed(1) + ' ms. Candidate: ' + latency.candidateMedianMs.toFixed(1) + ' ms. ' + improvementNote,
          detail: 'Objective ' + latency.objectiveId + ' v' + latency.objectiveVersion + '. Host measurements include sandbox startup. '
            + latency.fasterPairs + '/' + latency.observations.length + ' pairs were faster.'
        } : null,
        error: item.error || '', code: item.code,
        canExportOffer: !!evolution.offerLimits, exportDisabled: busy || offer.evaluating,
        send: swarm && evolution.offerLimits ? {
          peers: peers.map(peer => ({ value: peer.id, title: peer.label || 'Peer ' + peer.id.slice(0, 8) })),
          empty: peers.length ? 'Choose a peer' : 'Connect a peer',
          value: peers.some(peer => peer.id === peerChoice.get(item.id)) ? peerChoice.get(item.id) : null,
          disabled: busy || offer.evaluating
        } : null,
        decide: item.status === 'awaiting-approval' ? { disabled: busy || candidateBusy.has(item.id) } : null,
        rollback: item.status === 'adopted' && active.some(version => version.episodeId === item.id) ? { disabled: busy || candidateBusy.has(item.id) } : null
      };
    });
    const outbox = (offers?.outbox || []).map(record => {
      const expired = record.envelope.expiresAt <= now();
      let deliveryStatus = expired ? 'Delivery expired' : 'Delivery not confirmed';
      if (record.status === 'received') deliveryStatus = 'Received for preview';
      else if (record.status === 'refused') deliveryStatus = 'Refused: ' + record.reason;
      return { id: record.envelope.transferId, text: record.envelope.targetId + ' to Peer ' + record.envelope.recipient.slice(0, 8) + ' · ' + deliveryStatus,
      retry: !expired && ['sending', 'interrupted'].includes(record.status) && record.attempts < offers.maxAttempts };
    });
    return {
      empty: candidatesLoaded && !candidates.length,
      candidates: rows, status: experimentStatus, failed: candidatesFailed,
      offers: evolution.offerLimits ? {
        receive: { checked: offers?.accepting === true, disabled: !swarmState?.consumer || !offers },
        fileDisabled: offer.evaluating || busy,
        preview: offer.pending ? { target: offer.pending.offer.targetId, reason: offer.pending.offer.reason, code: offer.pending.offer.code,
          source: offer.pending.provenance ? 'From Peer ' + offer.pending.provenance.sender.slice(0, 8) + ' · not evaluated on this device' : 'Imported file · not evaluated on this device',
          evaluateDisabled: offer.evaluating || busy } : null,
        inbox: (offers?.inbox || []).filter(record => record.status === 'received' && !record.dismissed)
          .map(record => ({ id: record.transferId, text: record.envelope.targetId + ' offered by Peer ' + record.sender.slice(0, 8) })),
        outbox
      } : null
    };
  }

  function projectTraining() {
    if (!training) return null;
    const value = trainingState || {};
    const busy = !!value.busy;
    return {
      status: lora.status || `${value.phase}: ${value.message || 'Training is idle.'}`,
      error: lora.error,
      disabled: busy || lora.reading,
      adapterId: lora.adapterId, version: lora.version, consent: lora.consent,
      peers: lora.peers, coordinator: lora.coordinator, selected: lora.selected,
      downloads: lora.downloads && !!exported
    };
  }

  function project() {
    const state = workState;
    const showSelected = state ? state.selectedId !== null : false;
    const row = showSelected ? state.records.find(item => item.id === state.selectedId) : null;
    let inspectionStatus = state?.activity || '';
    if (state?.busy) inspectionStatus = state.activity;
    else if (row) inspectionStatus = capitalize(row.status || 'Saved');
    return Object.freeze({
      error: error || state?.storageError || '',
      history: state ? {
        visible: state.records.length > 0,
        records: [...state.records].reverse().map(attempt => ({
          id: attempt.id, goal: attempt.goal,
          badge: attempt.status === 'review' ? 'Ready to review' : attempt.status,
          meta: [attempt.modelName, new Date(attempt.createdAt).toLocaleDateString()].filter(Boolean).join(' · '),
          selected: showSelected && attempt.id === state.selectedId,
          reviseDisabled: !!state.runningIds?.includes(attempt.id) || !state.available,
          error: attempt.error || ''
        }))
      } : null,
      inspection: { open: inspectionOpen, result: row || state?.busy ? projectRecord(row, state) : null, busy: !!state?.busy,
        status: inspectionStatus },
      tools: projectTools(state),
      training: projectTraining()
    });
  }

  const unsubscribeWork = work?.subscribe?.(state => { workState = state; notify(); void refreshCandidates(); }) ?? (() => {});
  const unsubscribeTraining = training?.subscribe?.(value => {
    trainingState = value;
    if (value.phase === 'completed') { exported = training.getCandidate(); lora = { ...lora, downloads: !!exported }; }
    if (value.phase === 'preparing') { exported = null; lora = { ...lora, downloads: false }; }
    lora = { ...lora, status: '' };
    notify();
  }) ?? (() => {});
  // Peer offers and swarm state change without a notification of their own; the vanilla page re-read them each second.
  const timer = swarm ? setInterval(notify, 1000) : null;
  if (!work) void refreshCandidates();
  snapshot = project();

  const requireIdle = message => { if (workState?.busy) throw new Error(message); };
  const trainingRequest = () => {
    if (!lora.samples || lora.reading) throw new Error('Choose training samples first');
    return { samples: lora.samples, consent: lora.consent,
      adapter: { id: lora.adapterId.trim(), name: lora.adapterId.trim(), version: lora.version.trim() } };
  };
  const trainingAction = task => { lora = { ...lora, error: '' }; notify();
    return Promise.resolve().then(task).catch(cause => { if (!disposed) { lora = { ...lora, error: cause.message }; notify(); } }); };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    // Past attempts.
    select(id) { error = ''; inspectionOpen = true; act(() => work.select(id)); notify(); },
    setInspectionOpen(open) { inspectionOpen = !!open; notify(); },
    /** Prepares the revision as the home composer's draft; the page then opens home. */
    revise(id) { work.prepareRevision(id); },
    review(accepted) { return act(() => work.review(workState.selectedId, accepted)); },
    artifact(artifactId) { const artifact = work.getArtifact(workState.selectedId, artifactId); return { name: artifact.name, text: artifact.text, type: 'text/plain;charset=utf-8' }; },
    exportRecords() { return { name: 'reploid-work-evidence.json', text: JSON.stringify(work.exportRecords(), null, 2), type: 'application/json' }; },
    // Tool updates.
    async decide(id, adopt) {
      experimentStatus = ''; candidateBusy.add(id); notify();
      try {
        requireIdle('Wait for the task to finish before changing its tools');
        await evolution.decide(id, adopt);
        experimentStatus = adopt ? 'New tasks will use this version. The previous version is retained.' : 'Current version kept.';
      } catch (cause) { experimentStatus = cause.message; }
      finally { candidateBusy.delete(id); await refreshCandidates(); notify(); }
    },
    async rollback(id) {
      experimentStatus = ''; candidateBusy.add(id); notify();
      try {
        requireIdle('Wait for the task to finish before changing its tools');
        await evolution.rollback(id); experimentStatus = 'Previous version restored for new tasks.';
      } catch (cause) { experimentStatus = cause.message; }
      finally { candidateBusy.delete(id); await refreshCandidates(); notify(); }
    },
    async exportEvaluation(id) {
      const evidence = await evolution.export(id);
      return { name: 'reploid-tool-evaluation.json', text: JSON.stringify(evidence, null, 2), type: 'application/json' };
    },
    async exportOffer(id) {
      try {
        requireIdle('Wait for the task to finish before exchanging tools');
        const value = await evolution.exportOffer(id);
        experimentStatus = 'Candidate downloaded: code and description only. Import the file on another device to test it there.'; notify();
        return { name: 'reploid-tool-candidate.json', text: JSON.stringify(value, null, 2), type: 'application/json' };
      } catch (cause) { experimentStatus = cause.message; notify(); return null; }
    },
    choosePeer(id, peerId) { peerChoice.set(id, peerId); notify(); },
    async sendOffer(id) {
      try {
        requireIdle('Wait for the task to finish before exchanging tools');
        await swarm.sendCandidate(id, peerChoice.get(id)); experimentStatus = 'Delivery requested. Receipt is not evaluation or adoption.';
      } catch (cause) { experimentStatus = cause.message; }
      await refreshCandidates(); notify();
    },
    async importOfferFile(file) {
      const selected = ++offer.selection;
      offer = { ...offer, pending: null }; notify();
      if (!file) return;
      try {
        if (file.size > evolution.offerLimits.maxBytes) throw new Error('Candidate file exceeds its allowance');
        const text = await file.text(), inspected = await evolution.inspectOffer(text);
        if (disposed || selected !== offer.selection) return;
        offer = { ...offer, pending: { text, offer: inspected, provenance: null } };
        experimentStatus = 'Candidate loaded. Review its code before evaluating.';
      } catch (cause) { if (selected === offer.selection) experimentStatus = cause.message; }
      notify();
    },
    async previewPeerOffer(transferId) {
      const current = ++offer.selection;
      try {
        requireIdle('Wait for the task to finish before exchanging tools');
        const received = await swarm.previewCandidate(transferId);
        if (disposed || current !== offer.selection) return;
        offer = { ...offer, pending: { text: received.text, offer: received.offer, provenance: received.provenance } };
        experimentStatus = 'Candidate loaded. Review its code before evaluating.';
      } catch (cause) { experimentStatus = cause.message; }
      notify();
    },
    async dismissPeerOffer(transferId) {
      try { requireIdle('Wait for the task to finish before exchanging tools'); await swarm.dismissCandidate(transferId); experimentStatus = 'Candidate dismissed. Active tools are unchanged.'; }
      catch (cause) { experimentStatus = cause.message; }
      notify();
    },
    async retryOffer(transferId) {
      try { requireIdle('Wait for the task to finish before exchanging tools'); await swarm.retryCandidate(transferId); }
      catch (cause) { experimentStatus = cause.message; }
      notify();
    },
    allowOffers(on) { try { swarm.allowCandidateOffers(!!on); } catch (cause) { experimentStatus = cause.message; } notify(); },
    async evaluateOffer() {
      const pending = offer.pending;
      if (!pending || offer.evaluating) return;
      try {
        requireIdle('Wait for the task to finish before exchanging tools');
        offer = { ...offer, evaluating: true }; experimentStatus = 'Testing the imported candidate on this device...'; notify();
        const candidate = await evolution.importOffer(pending.text, { baselineGeneration: pending.offer.baselineGeneration, provenance: pending.provenance });
        offer = { ...offer, pending: null };
        experimentStatus = candidate.status === 'awaiting-approval' ? 'Local tests passed. Review the candidate before choosing Use this version.'
          : 'Candidate not ready for adoption. Its local test result is retained below.';
        await refreshCandidates();
      } catch (cause) { experimentStatus = cause.message; }
      finally { offer = { ...offer, evaluating: false }; notify(); }
    },
    // Training.
    async chooseSamples(file) {
      const current = ++lora.revision;
      lora = { ...lora, samples: null };
      if (!file) { notify(); return; }
      lora = { ...lora, reading: true, error: '' }; notify();
      try {
        if (file.size > training.policy.maxInputBytes) throw new Error('Training file exceeds the input allowance');
        const parsed = JSON.parse(await file.text());
        if (disposed || current !== lora.revision) return;
        const samples = Array.isArray(parsed) ? parsed : parsed.samples;
        if (!Array.isArray(samples) || !samples.length) throw new Error('Choose a JSON array of tokenized training samples');
        lora = { ...lora, samples, status: `${samples.length} training samples selected` };
      } catch (cause) { lora = { ...lora, samples: null, error: cause.message }; }
      finally { lora = { ...lora, reading: false }; notify(); }
    },
    setTrainingField(field, value) {
      if (!['adapterId', 'version', 'consent', 'coordinator', 'selected'].includes(field)) return;
      lora = { ...lora, [field]: value }; notify();
    },
    trainHere() { return trainingAction(async () => { exported = await training.run({ ...trainingRequest(), peers: [] }); lora = { ...lora, downloads: true }; notify(); }); },
    trainPooled() {
      return trainingAction(async () => {
        if (!lora.selected.length) throw new Error('Select at least one contributor');
        exported = await training.run({ ...trainingRequest(), peers: [...lora.selected] }); lora = { ...lora, downloads: true }; notify();
      });
    },
    stopTraining() { return trainingAction(() => training.stop()); },
    connectTraining() {
      return trainingAction(async () => {
        await training.connect();
        if (disposed) return;
        lora = { ...lora, peers: training.peers().map(peer => ({ id: peer.id, name: peer.name })), coordinator: '', selected: [] }; notify();
      });
    },
    contributeRound() {
      return trainingAction(() => {
        const input = trainingRequest();
        if (input.samples.length !== 1 || !lora.coordinator) throw new Error('Choose one sample and a coordinator');
        return training.contribute({ sample: input.samples[0], coordinator: lora.coordinator, consent: input.consent });
      });
    },
    adapterFile(kind) {
      if (!exported) return null;
      return kind === 'weights' ? { name: 'adapter.safetensors', text: exported.weights, type: 'application/octet-stream' }
        : { name: 'adapter.json', text: exported.json, type: 'application/json' };
    },
    clearError() { error = ''; notify(); },
    dispose() {
      if (disposed) return;
      disposed = true; candidateRevision++; offer.selection++; lora.revision++;
      unsubscribeWork(); unsubscribeTraining(); if (timer) clearInterval(timer); listeners.clear();
    }
  };
}
