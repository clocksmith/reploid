/** The model and computer a person last chose in "Answer on", kept per browser so New thread and a reload start
 * from it. It names a catalog choice and a route; it grants nothing.
 *
 * `picked` says whether the person chose that model themselves. A pick is kept as a pick: a later visit starts on
 * it, and when nothing serves or stores it the page says so and sends to no other model. A record without it (the
 * model came with the computer, or the record predates the field) carries only the route; the model is chosen
 * again from what is available.
 *
 * `name` is the label the pick was shown under. A pick can be read back before its model is listed (a private pool
 * loads after the page; a split route comes and goes), and the page then still names it, as unavailable. */
import { modelKey } from '../../host/decisions/model-state.js';

export const ANSWER_CHOICE_STORAGE_KEY = 'reploid.answer-choice.v1';
const ROUTES = new Set(['contributors', 'device']);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
const labelOf = model => [...new Set([model?.name, ...(model?.adapters || []).map(adapter => adapter.name || adapter.id)].filter(Boolean))].join(' + ');

export const answerChoiceOf = (model, route = null, picked = false) => {
  const selectionId = modelKey(model);
  return text(selectionId) ? { selectionId, identity: text(model.identity) ? model.identity : null, route: ROUTES.has(route) ? route : null,
    picked: picked === true, name: text(labelOf(model)) ? labelOf(model) : null } : null;
};

export function readAnswerChoice(storage) {
  try {
    const value = JSON.parse(storage?.getItem(ANSWER_CHOICE_STORAGE_KEY) ?? 'null');
    if (!value || !text(value.selectionId) || !(value.identity === null || text(value.identity))) return null;
    return { selectionId: value.selectionId, identity: value.identity, route: ROUTES.has(value.route) ? value.route : null,
      picked: value.picked === true, name: text(value.name) ? value.name : null };
  } catch { return null; }
}

/** `route` is 'contributors' or 'device'; a paired desktop or named computers are not carried to a later visit. */
export function writeAnswerChoice(storage, model, route, picked = false) {
  const choice = answerChoiceOf(model, route, picked);
  if (!choice) return;
  try { storage?.setItem(ANSWER_CHOICE_STORAGE_KEY, JSON.stringify(choice)); } catch { /* The choice still applies until this page closes. */ }
}

/** The catalog entry for a remembered choice: the same selection and, when one was recorded, the same identity. */
export function findAnswerChoice(choice, models = []) {
  if (!choice) return null;
  return models.find(item => modelKey(item) === choice.selectionId
    && (choice.identity === null || item.identity === choice.identity)) ?? null;
}
