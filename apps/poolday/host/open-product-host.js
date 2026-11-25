/**
 * Opens the Poolday product host the way every shell does: this instance's storage and room, the
 * earning loop beside the session (off unless this page's server publishes it), then the session.
 * The vanilla shell (ui/pool-home/index.js) and the React shell (apps/poolday-react) both use it.
 */
import { createProductSession } from './product-session.js';
import { openBrowserEarning, deferredEarning } from './credits/browser.js';
import { getPeerRoomId, getPeerRoomBusFactory, getOrderedParticipation } from './product-context.js';
import { getCurrentReploidStorage } from '../../../shared/instance.js';
import { resolveRtcConfig } from '../../../shared/pool/p2p-transport.js';

/** This instance's ordered participation; a malformed stage throws here, before any binding. */
export const resolveOrderedParticipation = () => getOrderedParticipation(getCurrentReploidStorage());

export function openProductHost({ operationNetwork = null, canonical = null, ordered, onChanges = () => {}, onDocuments = () => {}, onSharing = () => {} } = {}) {
  const storage = getCurrentReploidStorage();
  const earningOpening = openBrowserEarning({ storage }).catch(error => {
    console.warn('[Reploid] Credits are unavailable', error);
    return null;
  });
  const host = createProductSession({ webContribution: globalThis.REPLOID_WEB_CONTRIBUTION ?? null, storage, operationNetwork, canonical,
    ordered: ordered === undefined ? getOrderedParticipation(storage) : ordered, earning: deferredEarning(earningOpening),
    participantIdentity: async () => (await earningOpening)?.identity ?? null,
    networkOptions: () => ({ roomId: getPeerRoomId(), roomBusFactory: getPeerRoomBusFactory(), rtcConfig: resolveRtcConfig() }),
    onChanges, onDocuments, onSharing
  });
  return { host, earningOpening, storage };
}
