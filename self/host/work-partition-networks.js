import { createPartitionNetwork } from '../vendor/reploid/mesh/index.js';

/** Owns authenticated partition channels for one connected transport lifetime. */
export function createWorkPartitionNetworks({ transport, verifyPeer }) {
  const networks = new Set();
  let closing = null;
  return Object.freeze({
    open(options) {
      if (closing) throw new Error('Partition networks are closing');
      const network = createPartitionNetwork({ ...options, transport, verifyPeer });
      let settlement = null;
      const owned = Object.freeze({ ...network,
        close() {
          return settlement ||= Promise.resolve().then(() => network.close())
            .finally(() => networks.delete(owned));
        }
      });
      networks.add(owned); return owned;
    },
    close() {
      return closing ||= (async () => {
        const results = await Promise.allSettled([...networks].map(network => network.close()));
        const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
        if (failures.length) throw new AggregateError(failures, 'Partition network settlement failed');
      })();
    }
  });
}
