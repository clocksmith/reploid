/**
 * The shared model checks every view and decision reads: a catalog entry's key, whether it is stored on this device,
 * and which availability statuses count as serving, usable, preparing or selectable. Different questions keep
 * different names; none of them decides execution, which stays with the session (host/chat-execution.js).
 */

/** A catalog entry's selection: its route (`selectionId`) when it has one, else the model id. */
export const modelKey = model => model?.selectionId || model?.id;

/** Statuses of a computer that answers now: ready, or busy and taking requests. */
export const SERVING_STATUSES = Object.freeze(['ready', 'busy']);
/** Statuses a request can be sent on: serving, or stored here and loaded on Send. */
export const USABLE_STATUSES = Object.freeze([...SERVING_STATUSES, 'cached']);
/** Statuses of a model being prepared: it becomes usable without the person acting. */
export const PREPARING_STATUSES = Object.freeze(['loading', 'preparing']);

export const servingStatus = status => SERVING_STATUSES.includes(status);
export const usableStatus = status => USABLE_STATUSES.includes(status);
export const preparingStatus = status => PREPARING_STATUSES.includes(status);
/** Usable now or once prepared: a model the composer may stand on. */
export const selectableStatus = status => usableStatus(status) || preparingStatus(status);

/**
 * Stored on this device, so a request for it can stay here: loaded, downloaded, or reported cached. A split route
 * and a private pool's model never run here, whatever their flags: the session sends them on
 * (host/chat-execution.js, `staysHere` and the private-pool branch of execute).
 */
export const storedHere = model => !!model && !model.partition && !model.fleet
  && !!(model.localReady || model.localCached || model.availability === 'cached');

/**
 * Whether a public computer can answer with this whole model now. It is one predicate for two decisions that must
 * agree: the evidence that ends "Finding computers…" early (chat-session.js) and the capacity a visitor who chose
 * nothing is sent to (decisions/conversation-controller.js). A private pool's model and a split route are neither.
 */
export const servesPublicAnswers = model => !model.fleet && !model.partition && servingStatus(model.networkAvailability);

/** Listed under the public network: serving or being prepared there. */
export const sharedModelChoice = model => servingStatus(model.networkAvailability) || preparingStatus(model.networkAvailability);
