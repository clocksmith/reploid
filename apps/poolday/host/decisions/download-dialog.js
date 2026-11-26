/**
 * The reviewed download: the dialog that shows a model's size and this device's fit before anything is stored, and
 * the sharing choices that apply with it. It is the conversation controller's (conversation-controller.js), moved
 * here whole: `mode` is 'local' (store it to answer here) or 'contribute' (Computers' Start sharing: answer public
 * requests). The button and explanation name what confirming does: answering requests (compute), sharing model
 * files only (storage), or neither. Storage alone never starts compute.
 */
import { hasBrowserModelOrigin, modelVariantLabel } from '../../ui/components/model-select.js';
import { sharingOptionChoices } from '../../ui/pool-home/choice-availability.js';
import { localFitText } from '../../ui/pool-home/conversation-model-picker.js';
import { modelKey } from './model-state.js';

const confirmLabel = (mode, sharingValues, cached) => {
  const compute = sharingValues.includes('compute'), files = sharingValues.includes('files');
  if (compute && (mode === 'contribute' || !cached)) return cached ? 'Start sharing' : 'Download & share';
  if (files && !compute) return cached ? 'Share model files' : 'Download and share model files';
  return cached ? 'Apply settings' : 'Download model';
};
const downloadExplanation = (mode, sharingValues, cached) => {
  if (mode === 'local') return 'Store this model on this device to answer when network capacity is unavailable. Sharing choices apply to cached models on this device when you confirm.';
  const compute = sharingValues.includes('compute'), files = sharingValues.includes('files');
  if (compute) return cached ? 'Answer public requests while this page is open. Pause anytime.' : 'Download a model to answer public requests while this page is open. Pause anytime.';
  if (files) return cached ? 'Share this model’s files with other computers while this page is open. This device does not answer requests. Pause anytime.'
    : 'Download this model and share its files with other computers while this page is open. This device does not answer requests. Pause anytime.';
  return cached ? 'This device shares nothing for this model.' : 'Download this model without sharing it. This device does not answer requests or share files.';
};
// The session's network switches: compute (current and earlier name) and file sharing.
const computeOn = network => !!(network.computeEnabled ?? network.sharing);
const filesOn = network => !!(network.files?.enabled ?? network.files?.sharing);
/** The dialog's title: the model to download or share, or what choosing one does. */
function titleOf(chosen, mode) {
  if (!chosen) return mode === 'local' ? 'Download model' : 'Start sharing';
  return mode === 'local' ? `Download ${chosen.name || chosen.id}` : chosen.name || chosen.id;
}
const sharingOf = (compute, files) => [...(compute ? ['compute'] : []), ...(files ? ['files'] : [])];

/**
 * `getState` reads the session's current state; `notify` re-projects; `requestFocus` moves focus; `act` runs a
 * session command and reports its error; `sheetOpen` says whether "Answer on" is open (focus returns there);
 * `disposed` says the controller has gone.
 */
export function createDownloadDialog({ session, getState, notify, requestFocus, act, sheetOpen, disposed }) {
  let download = null, downloadRequest = null, downloadReview = null;
  const check = async () => {
    if (!download) return;
    downloadRequest?.abort(); const request = downloadRequest = new AbortController();
    download = { ...download, cached: false, size: 'Checking download size…', ready: false, retry: false, info: null };
    notify();
    try {
      if (!download.modelId) throw new Error('No model is available to download.');
      const info = await session.getModelDownload(download.modelId, { signal: request.signal });
      if (request.signal.aborted || disposed() || !download) return;
      const sessionState = getState();
      const model = sessionState.models?.find(row => modelKey(row) === info.id) || sessionState.models?.find(row => modelKey(row) === download.modelId);
      download = { ...download, info, size: Math.ceil(info.sizeBytes / 1e6) + ' MB download', ready: true, fit: localFitText(model, null, { sizeBytes: info.sizeBytes }) };
      notify();
      if (model && session.getLocalModelFit) session.getLocalModelFit(model, { signal: request.signal }).then(fit => {
        if (!request.signal.aborted && !disposed() && download) { download = { ...download, fit: localFitText(model, fit, { sizeBytes: info.sizeBytes }) }; notify(); }
      }).catch(() => {});
    } catch (cause) {
      if (!request.signal.aborted && !disposed() && download) { download = { ...download, size: cause.message, retry: true }; notify(); }
    }
  };
  return {
    /** The dialog's record for the snapshot, or null when closed. */
    view: () => download ? { ...download } : null,
    /** Opens the dialog on `modelId`. `review` keeps the "Answer on" sheet's context: `isCurrent(id)` and `onStored()`. */
    open(modelId, review = null, mode = 'local') {
      downloadReview = review;
      const state = getState();
      const models = (state.models || []).filter(model => !model.partition
        && (hasBrowserModelOrigin(model) || mode !== 'local' && (model.localReady || model.localCached))
        && (mode !== 'local' || !model.adapters?.length));
      const chosen = models.find(model => modelKey(model) === modelId) || null;
      const network = state.network || {};
      const compute = mode === 'contribute' || computeOn(network), filesShared = filesOn(network);
      const cached = mode !== 'local' && !!chosen && !!(chosen.localCached || chosen.localReady);
      const sharingValues = sharingOf(compute, filesShared);
      download = { open: true, mode, cached, modelId: chosen ? modelKey(chosen) : modelKey(models[0]) ?? null, choose: !chosen,
        title: titleOf(chosen, mode),
        models: models.map(model => ({ value: modelKey(model), title: modelVariantLabel(model) })),
        explanation: downloadExplanation(mode, sharingValues, cached),
        sharing: sharingOptionChoices({ canShareCompute: !!session.setComputeContribution, canShareFiles: !!session.setCachedFileContribution, compute, files: filesShared })
          .map(option => ({ value: option.value, title: option.title, status: option.status, disabled: !!option.disabled })),
        sharingValues,
        size: cached ? 'Downloaded' : 'Checking download size…', ready: cached, retry: false, fit: '', info: cached ? { cached: true } : null,
        confirm: confirmLabel(mode, sharingValues, cached) };
      requestFocus('download');
      notify();
      if (!cached) void check();
    },
    check,
    close() { downloadRequest?.abort(); download = null; downloadReview = null; requestFocus(sheetOpen() ? 'sheet' : 'composer'); notify(); },
    selectModel(modelId) { if (download) { download = { ...download, modelId }; void check(); } },
    setSharing(values) {
      if (!download) return;
      download = { ...download, sharingValues: [...values], confirm: confirmLabel(download.mode, values, download.cached),
        explanation: downloadExplanation(download.mode, values, download.cached) };
      notify();
    },
    confirm() {
      if (!download?.ready || !download.info) return;
      const { modelId, sharingValues, mode, cached } = download, review = downloadReview;
      download = null; downloadReview = null; notify();
      if (review && !review.isCurrent(modelId)) return;
      const compute = sharingValues.includes('compute'), shareFiles = sharingValues.includes('files');
      const contribute = mode === 'contribute' && compute;
      void act(async () => {
        const network = getState().network || {};
        const changeCompute = session.setComputeContribution && compute !== computeOn(network);
        const changeFiles = session.setCachedFileContribution && shareFiles !== filesOn(network);
        if (changeCompute && !compute) await session.setComputeContribution(false);
        if (changeFiles) await session.setCachedFileContribution(shareFiles);
        if (changeCompute && compute) await session.setComputeContribution(true);
        if (contribute) {
          if (network.paused) await session.connect();
          await session.setSharing(true, modelId, true);
        } else if (!cached) {
          if (review && !review.isCurrent(modelId)) return;
          await session.downloadLocalModel(modelId, true);
          if (!disposed() && review?.isCurrent(modelId)) review.onStored();
        }
      });
    },
    dispose() { downloadRequest?.abort(); }
  };
}
