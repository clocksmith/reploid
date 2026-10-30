/** Model actions retain their identity across discovery and metadata updates. */
export function bindContributionModels(container, session, { onChoose }) {
  const entries = new Map();
  let disposed = false;
  const eligible = model => !model.partition && !model.adapters?.length && model.source && model.provider === 'doppler';
  const size = value => value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB ↓` : `${Math.ceil(value / 1e6)} MB ↓`;
  const paint = (entry, issue) => {
    const { model, button, detail, metadata } = entry;
    button.querySelector('[data-model-name]').textContent = model.name || model.id;
    detail.textContent = model.localReady ? 'Ready' : model.localCached ? 'Downloaded'
      : metadata ? size(metadata.sizeBytes) : '';
    detail.hidden = !detail.textContent;
    button.disabled = !!issue;
    button.title = issue || (model.localReady || model.localCached ? 'Share this model'
      : entry.error ? 'Check download size and retry' : 'Review download and sharing');
  };
  const update = state => {
    if (disposed) return;
    const models = (state.models || []).filter(eligible);
    const ids = new Set(models.map(model => model.selectionId || model.id));
    for (const [id, entry] of entries) if (!ids.has(id)) {
      entry.controller.abort(); entry.button.remove(); entries.delete(id);
    }
    for (const model of models) {
      const id = model.selectionId || model.id;
      let entry = entries.get(id);
      if (entry && entry.model.identity !== model.identity) {
        entry.controller.abort(); entry.button.remove(); entries.delete(id); entry = null;
      }
      if (!entry) {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'pool-button pool-stack pool-gap-xs';
        button.dataset.productionModel = id;
        button.innerHTML = '<span data-model-name></span><span class="pool-caption" data-model-detail hidden></span>';
        entry = { model, button, detail: button.querySelector('[data-model-detail]'), controller: new AbortController() };
        entries.set(id, entry); container.append(button);
      }
      entry.model = model; paint(entry, state.localDownloadIssue);
      if (!model.localCached && !model.localReady && !entry.requested && !state.localDownloadIssue && session.getModelDownload) {
        entry.requested = true;
        const current = entry;
        Promise.resolve().then(() => session.getModelDownload(id, { signal: current.controller.signal })).then(info => {
          if (!Number.isSafeInteger(info?.sizeBytes) || info.sizeBytes <= 0) throw Error('Download size unavailable');
          current.metadata = info;
        }).catch(error => { current.error = error.message; }).finally(() => {
          if (!disposed && !current.controller.signal.aborted) paint(current, session.getState().localDownloadIssue);
        });
      }
    }
    container.hidden = models.length === 0;
  };
  const choose = event => {
    const button = event.target.closest('[data-production-model]');
    if (button && container.contains(button) && !button.disabled) onChoose(button.dataset.productionModel, button);
  };
  container.addEventListener('click', choose);
  return { update, dispose() {
    disposed = true; container.removeEventListener('click', choose);
    for (const entry of entries.values()) entry.controller.abort();
    entries.clear();
  } };
}
