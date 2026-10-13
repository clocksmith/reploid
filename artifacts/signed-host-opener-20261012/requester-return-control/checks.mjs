import { isDeepStrictEqual } from 'node:util';

export function projectHistory(observation) {
  if (!Array.isArray(observation?.threads)) return null;
  return observation.threads.map(thread => ({
    id: thread.id, modelIdentity: thread.model.identity,
    messages: thread.messages, attempts: thread.attempts
  }));
}
export function emptyCustody(value) {
  return value?.state?.receivedBytes === 0 && value.state.verifiedFiles?.length === 0
    && value.receipts?.length === 0 && value.state.pending === 0
    && !value.state.preparing && !value.state.sharing;
}
export function assessReceipt(report, fixture) {
  const failures = [];
  const require = (condition, reason) => { if (!condition) failures.push(reason); };
  require(report.turns?.length === 2, 'Two completed turns required');
  const first = report.turns?.[0], second = report.turns?.[1];
  if (first && second) {
    require(first.id === second.id, 'Follow-up must use the same conversation');
    const a = first.attempts.at(-1), b = second.attempts.at(-1);
    require(a.id !== b.id && second.attempts.length === first.attempts.length + 1, 'Exactly one new follow-up attempt required');
    for (const [index, thread] of report.turns.entries()) {
      const attempt = thread.attempts.at(-1), response = thread.messages.find(message => message.id === attempt.responseId);
      require(attempt.status === 'completed' && response?.status === 'completed', `Turn${index + 1} not complete`);
      require(attempt.execution?.stopReason === 'eos-token', `Turn${index + 1} natural EOS unobserved`);
      const execution = attempt.execution, owners = [execution?.participantA, execution?.participantB];
      require(execution?.placement === 'two-device-layer-partition' && owners.every(Boolean) && owners[0] !== owners[1], `Turn${index + 1} complementary contributors unobserved`);
      require(owners.every(id => execution?.settlement?.cleanup?.some(row => row.participantId === id && row.status === 'settled')), `Turn${index + 1} cleanup not confirmed`);
    }
    if (fixture.kind === 'readiness-control') require(report.turns.every(thread => thread.messages.at(-1)?.content.trim() === 'READY'), 'READY route-control output differs');
    const response = first.messages.find(message => message.id === a.responseId);
    const expected = [{ role: 'user', content: fixture.questions[0] }, { role: 'assistant', content: response.content }, { role: 'user', content: fixture.questions[1] }];
    const actual = b.request?.messages?.filter(message => message.role !== 'system');
    require(isDeepStrictEqual(actual, expected), 'Actual first answer missing or changed in ordered follow-up');
    const samples = report.streamSamples?.filter(row => row.attemptId === a.id && row.messageId === response.id) || [];
    require(fixture.kind === 'readiness-control' || samples.some(row => row.status !== 'completed' && row.content.length > 0 && row.content.length < response.content.length
      && response.content.startsWith(row.content) && row.renderedText?.length > 0), 'Visible incomplete streamed first-answer prefix unobserved');
    require(report.copy?.messageId === response.id && report.copy.clipboardText === response.content, 'Real Copy output differs from stored answer');
  }
  require(report.weights?.length === 0 && [report.custodyBefore, report.custodyAfter, report.custodyAfterReload].every(emptyCustody), 'Requester received or retained weights, or custody evidence is missing');
  require(report.beforeReload && report.restoredState && isDeepStrictEqual(projectHistory(report.beforeReload), projectHistory(report.restoredState)), 'Reload changed messages or attempts');
  require(report.restoration?.draft === fixture.draft, 'Reload lost unsent draft');
  require(report.returnSamples?.length >= 2 && report.returnSamples.every(sample => sample.runningIds.length === 0 && isDeepStrictEqual(sample.history, projectHistory(report.beforeReload))), 'New/changed attempt observed after reload, or return observations missing');
  require(report.returnObservationMs >= fixture.postRediscoveryObservationMs, 'Bounded redispatch observation incomplete');
  return { lifecycleAndInteractionPass: failures.length === 0, failures,
    semanticAcceptance: null, overallAcceptance: false, usefulConversationQualified: false,
    semanticReviewRequired: fixture.reviewCriteria.slice(0, 4),
    redispatchScope: 'No changed attempt/history or running attempt during the recorded return interval; not proof about all future execution.' };
}
