// Reads the conversation controller (apps/poolday/host/decisions/conversation-controller.js) the way a person reads
// the screen: the composer, the "Answer on" sheet, the reviewed download and the transcript, by the names the vanilla
// page gave them. The React screens render exactly these records (apps/poolday-react/src/features/chat).
import { createConversationController } from '../../apps/poolday/host/decisions/conversation-controller.js';

export function openConversation(session, options = {}) {
  const controller = createConversationController(session, { href: () => globalThis.location?.href || 'http://localhost/', ...options });
  const snapshot = () => controller.getSnapshot();
  const sheet = () => snapshot().sheet;
  return {
    controller,
    snapshot,
    composer: () => snapshot().composer,
    sheet,
    /** The row for a computer in the open sheet: `checked`, `status`, `disabled`. */
    computer: choice => sheet().open ? sheet().computers.find(row => row.choice === choice) ?? null : null,
    checkedComputer: () => sheet().open ? sheet().computers.find(row => row.checked)?.choice ?? null : null,
    /** Model rows of the open sheet, flattened. */
    modelRows: () => sheet().open ? sheet().sections.flatMap(section => section.rows) : [],
    /** Types a draft and presses Send. */
    send(text) { if (text !== undefined) controller.setDraft(text); controller.send(); },
    dispose: () => controller.dispose()
  };
}
