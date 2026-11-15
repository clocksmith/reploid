/** One guard for all retrieval data ports. Descriptions contain identities only, never query/claim/passage text. */
export function guardRetrievalPort(port, operation, beforeDisclosure, signal) {
  if (!port || !beforeDisclosure) return port;
  const execute = port[operation];
  const identity = { operation, id: port.id, version: port.version };
  return { ...port, async [operation](...args) {
    const current = () => {
      signal?.throwIfAborted();
      if (port.id !== identity.id || port.version !== identity.version || port[operation] !== execute) throw new Error('Retrieval implementation changed before disclosure');
    };
    current();
    if (await beforeDisclosure({ ...identity }) !== true) throw new Error('Retrieval disclosure was denied');
    current();
    return execute.apply(port, args);
  } };
}
