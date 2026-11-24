/** Test-only: a disclosure preview carrying the execution binding a real requester attaches before any content leaves. */
import { bindExecutionRoute, plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';

/** The participants an HTTP plan pins for a model: every stage of a split, or none (one eligible provider) for a whole model. */
export const routeParticipants = model => model?.partition
  ? [...new Set(model.partition.route?.stages?.map(stage => stage.participantId)
    ?? [model.partition.participantA, model.partition.participantB].filter(Boolean))] : null;

/** Bind `preview` to `request` under the request's own (already compiled) policy. */
export async function bindPreview(request, preview, recipients = routeParticipants(request.model)
  ?? preview.recipients ?? [preview.recipientIdentity ?? preview.providerId]) {
  const privacyBinding = await bindExecutionRoute(request, plaintextExecutionRoute(request, { recipients }));
  return { ...preview, privacyBinding };
}
