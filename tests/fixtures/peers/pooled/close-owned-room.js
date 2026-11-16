// The selected SDK does not await freeLayers' engine/expert close promises.
export async function closeOwnedPeerRoom(room, ownedGpus) {
  const owners = [...new Set([room?.ai?.engine, room?.ai?.experts, room?.ai?.engine?.experts])]
    .filter(owner => typeof owner?.close === 'function');
  const methods = owners.map(owner => ({ owner, original: owner.close }));
  for (const method of methods) {
    let closing;
    method.owner.close = () => closing ??= Promise.resolve().then(() => method.original.call(method.owner));
  }
  const failures = [];
  try {
    if (room) room.closing = true;
    const results = await Promise.allSettled(owners.map(owner => owner.close()));
    failures.push(...results.flatMap(result => result.status === 'rejected' ? [result.reason] : []));
    try { await room?.close(); } catch (error) { failures.push(error); }
  } finally {
    for (const { owner, original } of methods) owner.close = original;
    // webgpu's documented Node lifetime is tied to this global reference.
    // Clear only an instance created by this owned adapter, never another GPU.
    if (ownedGpus.has(globalThis.navigator?.gpu)) delete globalThis.navigator.gpu;
    ownedGpus.clear();
  }
  if (failures.length) throw new AggregateError(failures, 'Owned peer cleanup failed');
}
