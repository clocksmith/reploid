/** The model and computer a person last chose in "Answer on", kept per browser so New thread and a reload start
 * from it. It names a catalog choice and a route; it grants nothing. The workspace checks it against the catalog on
 * each use and falls back to the default when, after the bounded discovery wait, nothing serves or stores it. */
export const ANSWER_CHOICE_STORAGE_KEY = 'reploid.answer-choice.v1';
const ROUTES = new Set(['contributors', 'device']);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;

export const answerChoiceOf = (model, route = null) => {
  const selectionId = model?.selectionId || model?.id;
  return text(selectionId) ? { selectionId, identity: text(model.identity) ? model.identity : null, route: ROUTES.has(route) ? route : null } : null;
};

export function readAnswerChoice(storage) {
  try {
    const value = JSON.parse(storage?.getItem(ANSWER_CHOICE_STORAGE_KEY) ?? 'null');
    if (!value || !text(value.selectionId) || !(value.identity === null || text(value.identity))) return null;
    return { selectionId: value.selectionId, identity: value.identity, route: ROUTES.has(value.route) ? value.route : null };
  } catch { return null; }
}

/** `route` is 'contributors' or 'device'; a paired desktop or named computers are not carried to a later visit. */
export function writeAnswerChoice(storage, model, route) {
  const choice = answerChoiceOf(model, route);
  if (!choice) return;
  try { storage?.setItem(ANSWER_CHOICE_STORAGE_KEY, JSON.stringify(choice)); } catch { /* The choice still applies until this page closes. */ }
}

/** The catalog entry for a remembered choice: the same selection and, when one was recorded, the same identity. */
export function findAnswerChoice(choice, models = []) {
  if (!choice) return null;
  return models.find(item => (item.selectionId || item.id) === choice.selectionId
    && (choice.identity === null || item.identity === choice.identity)) ?? null;
}
