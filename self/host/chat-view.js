/** Pure projections. Discovery describes availability; accepted attempts own history. */
export function projectChatCatalog({ models, peers, partitionModels }) {
  const selections = models.flatMap(model => [model, ...(model.availableAdapters || []).map(adapter => ({
    ...model, name: adapter.name, selectionId: model.id + '/' + adapter.id, adapters: [adapter]
  }))]);
  const routes = [...partitionModels];
  for (const model of models) {
    if (!model.executionModes?.includes('partition') || !model.partitionPlanId) continue;
    const selectionId = model.id + '/partition/' + model.partitionPlanId;
    if (!routes.some(route => route.selectionId === selectionId)) routes.push({ ...model, selectionId,
      partition: { planId: model.partitionPlanId }, availability: 'unavailable', providerIds: [] });
  }
  return selections.map(model => {
    const compatible = peers.filter(peer => peer.model === model.id && peer.modelIdentity === model.identity
      && (model.adapters || []).every(adapter => peer.adapterIdentities?.includes(adapter.identity)));
    const ready = compatible.filter(peer => peer.readiness === 'ready' && peer.hasInference);
    const loading = compatible.some(peer => peer.readiness === 'loading');
    return { ...model, availability: ready.length ? (ready.some(peer => peer.availableSlots > 0) ? 'ready' : 'busy')
      : loading ? 'loading' : 'unavailable', providerIds: ready.map(peer => peer.peerId) };
  }).concat(routes);
}

export function projectChatPlacements(threads) {
  return Object.fromEntries(threads.flatMap(thread => {
    const completed = thread.attempts.findLast(attempt => attempt.status === 'completed' && attempt.execution);
    return completed ? [[thread.id, completed.execution]] : [];
  }));
}
