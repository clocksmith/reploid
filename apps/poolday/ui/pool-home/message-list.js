

// An unsettled dispatched answer keeps its hold; say how much, since the ledger settles it later.
function heldNote(attempt) {
  const credit = attempt.execution?.serviceCredit;
  return credit && typeof credit.settledAt !== 'number' && Number.isSafeInteger(credit.heldCredits) && credit.heldCredits > 0
    ? ` ${credit.heldCredits.toLocaleString()} service credits stay held until this answer is settled; Computers, Service credits shows the outcome.` : '';
}

/** Why an attempt did not finish, as the transcript states it. */
export function failureLabel(attempt) {
  // The paired host's ledger refused before any hold or disclosure (server/fleet/credits.js).
  const short = /not enough service credits\. This answer can cost up to (\d+) and (\d+) can be spent now/.exec(attempt.error || '');
  if (short) return `Not sent. Not enough service credits: this answer can cost up to ${short[1]} and your account can spend ${short[2]} now. Serving answers for others earns more.`;
  const unfinished = /Service-credit admission limit reached: (\d+) unfinished answers/.exec(attempt.error || '');
  if (unfinished) return `Not sent. ${unfinished[1]} answers on this account are still unfinished. Try again when one settles.`;
  return failureReason(attempt) + heldNote(attempt);
}

function failureReason(attempt) {
  if (attempt.retrieval?.error?.code === 'timeout' || /retrieval exceeded its time limit/i.test(attempt.error || '')) {
    const stage = attempt.retrieval?.error?.stage;
    const action = stage === 'search' ? 'Web search' : stage === 'extraction' ? 'Reading search results' : 'Source retrieval';
    const limit = attempt.retrieval?.limits?.timeoutMs;
    return `${action} timed out${Number.isFinite(limit) ? ` after ${limit / 1000} seconds` : ''}. No model answer was generated.`;
  }
  if (attempt.retrieval?.outcome === 'failed' || /^Could not retrieve sources:/i.test(attempt.error || '')) {
    return `${attempt.error || 'Source retrieval failed.'} No model answer was generated.`;
  }
  if (attempt.error === 'Disclosure declined') return 'Not sent. You declined sharing this request.';
  if (attempt.status === 'cancelled') return 'Stopped. Your partial answer is saved.';
  if (/disconnect|peer.*lost|contributor.*lost|no longer ready|Failed to send swarm|connection to this computer changed/i.test(attempt.error || '')) {
    // A lost computer ends the attempt. Its partial text is kept but was never signed, and nothing is resent.
    return 'Interrupted. That computer went away before finishing, so any text above is unverified. Nothing was resent. Retry to ask again, or change where this conversation runs.';
  }
  if (/memory|allocation|resource.*exhaust|budget/i.test(attempt.error || '')) return 'This answer exceeded the available resources.';
  if (/quoted terms were not accepted/i.test(attempt.error || '')) return 'Not sent. The quote is above your spending limit, or no limit is set (Settings, Credits).';
  if (/Community Access (is not available|refused)/i.test(attempt.error || '')) return 'Not sent. Community Access cannot take this answer now.';
  if (/acknowledgments are overdue/i.test(attempt.error || '')) return 'Stopped. This device did not confirm the received output in time; only confirmed output is charged.';
  if (/quoted (first-output )?deadline passed/i.test(attempt.error || '')) return 'Stopped at the quoted deadline.';
  if (attempt.status === 'interrupted') return 'This answer was interrupted.';
  return 'This answer could not finish.';
}
