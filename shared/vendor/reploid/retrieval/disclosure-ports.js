/** One guard for all retrieval data ports. Descriptions contain identities only, never query/claim/passage text. */
import { SEARCH_DISCLOSURE_PROTOCOL } from './disclosure-path.js';

export function guardRetrievalPort(port, operation, beforeDisclosure, signal) {
  if (!port || !beforeDisclosure) return port;
  const execute = port[operation], describe = port.describeDisclosure;
  const identity = { operation, id: port.id, version: port.version };
  return { ...port, async [operation](...args) {
    const current = () => {
      signal?.throwIfAborted();
      if (port.id !== identity.id || port.version !== identity.version || port[operation] !== execute || port.describeDisclosure !== describe) throw new Error('Retrieval implementation changed before disclosure');
    };
    current();
    const detail = { ...identity, ...(operation === 'extract' && describe ? { resourceOrigin: new URL(args[0].source.url).origin } : {}) };
    const path = describe ? await describe(detail) : null;
    current();
    const authorization = await beforeDisclosure(detail, path);
    if (authorization !== true && authorization?.schema !== 'reploid.auxiliary-binding/v1') throw new Error('Retrieval disclosure was denied');
    current();
    if (port.privacyProtocol === SEARCH_DISCLOSURE_PROTOCOL && authorization !== true && authorization.path.complete) {
      if (operation === 'search') args[3] = { ...args[3], disclosure: authorization };
      else args[0] = { ...args[0], disclosure: authorization };
    }
    return execute.apply(port, args);
  } };
}
