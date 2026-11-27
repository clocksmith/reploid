import { computerLabel } from './computer-labels.js';
import { publicProviderHardware } from '../../../../shared/vendor/reploid/mesh/provider-hardware.js';
const measured = value => Number.isFinite(value) && value >= 0;
const sum = (steps, key) => steps?.length && steps.every(step => measured(step[key])) ? steps.reduce((n, step) => n + step[key], 0) : null;
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
/** Self-reported GPU text, or null when nothing usable was reported. Never an attestation.
 * The adapter's vendor, architecture and device name identify the GPU; a native adapter's
 * description is often its driver, so it is shown only when nothing else was reported. */
export function hardwareText(value) {
  const hardware = publicProviderHardware(value);
  const reported = text => !!text && text.toLowerCase() !== 'unknown';
  const identity = [...new Set([hardware?.vendor, hardware?.architecture, hardware?.device].filter(reported))];
  return identity.length ? identity.join(' · ') : reported(hardware?.description) ? hardware.description : null;
}
export const RECORDED_GPU_TITLE = 'Reported by the computer that produced this answer and saved with it. Not verified.';
/** The adapter a completed answer records as executed, named from the request it was checked against.
 * Null when neither the request nor the record names an adapter. */
export function recordedAdapterText(attempt, model) {
  if (attempt?.status !== 'completed') return null;
  const requested = model?.adapters || [], recorded = attempt.execution?.adapterIdentities;
  if (!Array.isArray(recorded)) return requested.length ? 'Adapter not recorded' : null;
  return recorded.map(identity => {
    const adapter = requested.find(item => item.identity === identity);
    return [adapter?.name || 'Unnamed adapter', adapter?.manifest?.version ? `v${adapter.manifest.version}` : null, identity].filter(Boolean).join(' · ');
  }).join('; ') || (requested.length ? 'No adapter recorded' : null);
}
/**
 * The model an answer names, from its own execution evidence: the provider-signed receipt, else the execution record,
 * else the request the attempt was created with. Never the conversation's current model or the picker. The name is
 * the one the conversation, the attempt's request or the catalog lists for that exact identity; without one, the
 * evidence's own model id.
 */
export function answeredModel(state, thread, attempt) {
  const execution = attempt?.execution, receipt = execution?.executionReceipt;
  const evidence = typeof receipt?.modelIdentity === 'string' ? { id: receipt.model ?? null, identity: receipt.modelIdentity }
    : typeof execution?.modelIdentity === 'string' ? { id: execution.modelId ?? null, identity: execution.modelIdentity } : null;
  // An attempt that has recorded no execution evidence yet (still running, or saved before it was kept) names the
  // model it was created with.
  const asked = attempt?.request?.model ?? thread?.model ?? null;
  if (!evidence) return { id: asked?.id ?? null, identity: asked?.identity ?? null, name: asked?.name ?? null };
  const named = [thread?.model, attempt?.request?.model, ...(state?.models || [])]
    .find(model => model?.name && model.identity === evidence.identity && (evidence.id === null || model.id === evidence.id));
  return { ...evidence, name: named?.name ?? evidence.id };
}
/**
 * The computer that provided a whole-model answer, from the same execution evidence as its model: the operation roles
 * its requester derived from the countersigned receipt (reploid.operation-roles/1), else the execution record's peer.
 * `connectionId` is the connection it answered on, which the roster labels; `participantId` and `computerId` are null
 * when nothing verified them.
 */
export function answeredProvider(attempt) {
  const execution = attempt?.execution, provider = execution?.operationRoles?.provider;
  const connectionId = provider?.connectionId ?? execution?.peerId ?? null;
  return connectionId || provider?.participantId ? { connectionId, participantId: provider?.participantId ?? null, computerId: provider?.computerId ?? null } : null;
}
const orderedTiming = (execution, index) => {
  const summary = execution?.stepSummary;
  if (summary) {
    const row = summary.stages?.find(stage => stage.partitionIndex === index);
    return Number.isSafeInteger(summary.count) && summary.count > 0 && row?.steps === summary.count
      && row.stepMs?.count === summary.count && measured(row.stepMs.total) ? row.stepMs : null;
  }
  const values = execution?.steps?.map(step => step.stages?.find(stage => stage.partitionIndex === index)?.elapsedMs);
  return values?.length && values.every(measured) ? { count: values.length, total: values.reduce((a, b) => a + b, 0) } : null;
};

export function projectExecutionRibbon(state) {
  const thread = state.activeThread, attempt = thread?.attempts.at(-1), execution = attempt?.execution;
  const ordered = execution?.identity?.schema === 'reploid.partition-attempt/v2'
    && execution.identity.route?.schema === 'reploid.partition-route/v1' && Array.isArray(execution.identity.route.stages)
    ? execution.identity.route : null;
  const requester = (ordered ? execution.identity.requesterId : execution?.requesterId) || state.participantId || 'This device';
  const local = execution?.placement === 'local-webgpu';
  const split = !!ordered || execution?.placement === 'two-device-layer-partition';
  // Selected/discovered models are not proof of placement. Use this attempt's receipt only.
  const ids = ordered ? ordered.stages.map(stage => stage.participantId) : local ? [requester] : split ? [execution.participantA, execution.participantB].filter(Boolean)
    : answeredProvider(attempt)?.connectionId ? [answeredProvider(attempt).connectionId] : [];
  const layer = Number.isSafeInteger(execution?.splitLayer) ? execution.splitLayer : null;
  // What ran, as saved with a completed answer; current providers are read in the model picker.
  // A whole-model answer saves its executor's reported GPU; distributed stages save none.
  const recorded = hardwareText(!split && ids.length === 1 ? execution?.hardware : null);
  const recordedGpu = attempt?.status === 'completed' ? recorded ? `Recorded GPU · ${recorded}` : 'GPU not recorded' : null;
  const executors = ids.map((id, i) => ({ id, label: execution?.privateDelegation?.computers?.[id] || (id === requester ? 'This device' : computerLabel(state, id)), recordedGpu,
    layers: ordered ? `Stage ${i + 1} of ${ids.length}` : split ? layer === null ? 'Not reported' : i === 0 ? `0–${layer - 1}` : `${layer} onward` : 'Whole model',
    contribution: ordered ? i === 0 ? 'Initial layers; relays output' : i === ids.length - 1 ? 'Final layers; produces output' : 'Intermediate layers'
      : split ? i === 0 ? 'Initial layers; relays output' : 'Final layers; produces output' : 'Whole-model execution',
    timing: ordered ? orderedTiming(execution, i) : null,
    duration: ordered ? orderedTiming(execution, i)?.total ?? null : split ? sum(execution.steps, i === 0 ? 'localStepMs' : 'remoteStepMs') : null }));
  const active = attempt && !terminal.has(attempt.status);
  let status = attempt?.status || 'idle';
  // Discovery reports availability, never the health of an assigned execution channel.
  if (active && attempt.retryOf && ['queued', 'loading'].includes(status)) status = 'recovering';
  const ready = (state.models || []).filter(model => model.availability === 'ready');
  const downloading = state.localModel?.phase === 'loading';
  const progress = state.localModel?.progress?.progress;
  const preparing = downloading || (state.models || []).some(model => ['loading', 'preparing'].includes(model.availability))
    || (state.network?.partitionPeers || []).some(peer => peer.available && peer.description?.phase === 'loading'
      && (state.models || []).some(model => model.id === peer.description.offer?.id && model.identity === peer.description.offer?.identity));
  const availability = ready.length ? `${ready.length} model${ready.length === 1 ? '' : 's'} ready`
    : downloading ? 'Downloading model' + (measured(progress) ? ` ${Math.round(progress * 100)}%` : '')
    : preparing ? 'Preparing model' : state.network?.paused ? 'Disconnected' : state.network?.connecting || ['connecting', 'retrying'].includes(state.network?.consumer?.connectionState) ? 'Finding capacity' : 'No model ready';
  const labels = { idle: availability, queued: 'Queued', loading: 'Loading', executing: 'Executing', approval: 'Permission needed',
    completed: 'Complete', failed: 'Failed', cancelled: 'Stopped', cancelling: 'Stopping', interrupted: 'Interrupted', disconnected: 'Disconnected', recovering: 'Recovering' };
  const response = thread?.messages.find(message => message.id === attempt?.responseId)?.content || '';
  return { key: attempt ? `${thread.id}:${attempt.id}` : null, thread, attempt, execution, requester, local, split, ordered: !!ordered, executors,
    planId: ordered?.planId || execution?.planId,
    requesterExecutes: executors.some(node => node.id === requester),
    model: executors.length ? answeredModel(state, thread, attempt).name : null, adapter: recordedAdapterText(attempt, thread?.model), status, statusLabel: labels[status] || status,
    response, active: !!active, totalMs: measured(attempt?.finishedAt) && measured(attempt?.createdAt) ? attempt.finishedAt - attempt.createdAt : null,
    transferMs: sum(execution?.steps, 'transferMs'), activationBytes: measured(execution?.activationBytes) ? execution.activationBytes : null };
}
