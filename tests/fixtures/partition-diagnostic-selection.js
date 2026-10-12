import assert from 'node:assert/strict';
/** Select an unchanged complete request, optionally one observed boundary. */
export function selectPartitionDiagnostic({ prompt, step, reference }) {
  const selectedPrompt = prompt === undefined ? null : Number(prompt);
  const selectedStep = step === undefined ? null : Number(step);
  if (selectedPrompt !== null || selectedStep !== null) {
    assert(prompt !== '' && Number.isSafeInteger(selectedPrompt) && selectedPrompt >= 0, 'Invalid diagnostic prompt');
    assert(reference?.expected[selectedPrompt]?.steps?.length > 0, 'Selected frozen request is missing');
    if (selectedStep !== null) {
      assert(step !== '' && Number.isSafeInteger(selectedStep) && selectedStep >= 0, 'Invalid diagnostic step');
      assert(reference.expected[selectedPrompt].steps[selectedStep], 'Selected frozen boundary is missing');
    }
  }
  return { prompt: selectedPrompt, step: selectedStep, promptOnly: selectedPrompt !== null && selectedStep === null };
}

/** Only these existing controller phases have host-neutral resident operations. */
export function assertNativePartitionPhase(phase, referenceHost) {
  assert(['reference', 'concurrent'].includes(phase) && !referenceHost,
    'Native adapter supports frozen split reference and concurrent lifecycle phases only');
}
