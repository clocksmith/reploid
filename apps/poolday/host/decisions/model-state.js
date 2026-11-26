/**
 * The shared model checks every view and decision reads: a catalog entry's key, whether it is stored on this device,
 * and which availability statuses count as serving, usable, preparing or selectable. Different questions keep
 * different names; none of them decides execution, which stays with the session (host/chat-execution.js).
 * The checks the session's own projections use live in chat-view.js, which must stay import-free
 * (scripts/verify-layers.js); they are re-exported here so every other reader has one place to import from.
 */
import { SERVING_STATUSES, USABLE_STATUSES, servesPublicAnswers, storedHere } from '../chat-view.js';

export { SERVING_STATUSES, USABLE_STATUSES, servesPublicAnswers, storedHere };

/** A catalog entry's selection: its route (`selectionId`) when it has one, else the model id. */
export const modelKey = model => model?.selectionId || model?.id;

/** Statuses of a model being prepared: it becomes usable without the person acting. */
export const PREPARING_STATUSES = Object.freeze(['loading', 'preparing']);

export const servingStatus = status => SERVING_STATUSES.includes(status);
export const usableStatus = status => USABLE_STATUSES.includes(status);
export const preparingStatus = status => PREPARING_STATUSES.includes(status);
/** Usable now or once prepared: a model the composer may stand on. */
export const selectableStatus = status => usableStatus(status) || preparingStatus(status);

/** Listed under the public network: serving or being prepared there. */
export const sharedModelChoice = model => servingStatus(model.networkAvailability) || preparingStatus(model.networkAvailability);
