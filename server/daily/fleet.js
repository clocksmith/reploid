// The browser never receives the fleet identity, disclosure authorization, or credit credentials.
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { canonicalize } from '../../packages/reploid/src/artifacts/canonical-json.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { matchesWholeModelReceipt } from '../../packages/reploid/src/artifacts/whole-model-receipt.js';
import { partitionAdapterIdentities } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { assertSettingsSupported, effectiveRequestDigest, normalizeGenerationSettings } from '../../packages/reploid/src/mesh/generation-settings.js';
import { hasReversePromptTemplate } from '../../shared/infrastructure/reverse-prompt-profile.js';
import { PROFILE } from './rules.js';

const digest = /^sha256:[a-f0-9]{64}$/;
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const same = (left, right) => left !== undefined && canonicalize(left) === canonicalize(right);

function promptRoute(host, pins) {
  const route = host.textParticipant.getState().models?.find(model => !model.partition
    && model.id === pins.modelId && model.identity === pins.modelIdentity
    && !partitionAdapterIdentities(model).length && ['ready', 'busy'].includes(model.availability)
    && Object.values(model.verifiedProviderIdentities ?? {}).includes(pins.providerId));
  if (!route) return null;
  const peer = host.textParticipant.getNetworkState().peers?.find(row => row.identityVerified
    && row.participantId === pins.providerId && route.providerIds.includes(row.peerId));
  requireValue(peer?.admissionProtocol === 1, 'Named provider must admit the pinned attempt before prompt disclosure');
  assertSettingsSupported(peer.generationSettings, pins.settings);
  assertSettingsSupported(route.generationSettings, pins.settings);
  return route;
}

/** A dedicated requester and an owner-qualified remote provider are required. This adapter owns
 * the native host it opens. A normal completion returns the private, countersigned mesh receipt. */
export async function openDailyFleet({ configFile, modelId, modelIdentity, providerId, backendIdentityHash }) {
  requireValue(modelId === PROFILE.modelId && modelIdentity === PROFILE.modelIdentity
    && /^peer:[a-f0-9]{24}$/.test(providerId) && digest.test(backendIdentityHash),
  'The daily fleet requires the pinned base model, enrolled provider and qualified backend');
  const settings = normalizeGenerationSettings({ maxOutputTokens: PROFILE.maxOutputTokens,
    reversePrompt: { schema: 'reploid.reverse-prompt/v1', backendIdentityHash } });
  const pins = { modelId, modelIdentity, providerId, settings };
  const { readOwnFile, openFleetNativeHost } = await import('../fleet/native-host.js');
  const configuration = JSON.parse(await readOwnFile(configFile));
  requireValue(configuration.schema === 'reploid.fleet-native/v1' && configuration.serviceUrl
    && configuration.initialContribution !== true && !configuration.textApi && !configuration.browserBridge
    && Number.isSafeInteger(configuration.maxOutputTokens) && configuration.maxOutputTokens >= PROFILE.maxOutputTokens,
  'Accounted private fleet configuration and a sufficient credit ceiling required');
  const index = configuration.models?.findIndex(entry => entry.mode === 'partition' && !entry.ordered
    && entry.model?.provider === 'doppler' && entry.model.id === modelId && entry.model.identity === modelIdentity
    && !partitionAdapterIdentities(entry.model).length && Number.isSafeInteger(entry.model.generation?.maxTokens)
    && entry.model.generation.maxTokens >= PROFILE.maxOutputTokens);
  requireValue(Number.isInteger(index) && index >= 0, 'Private requester requires the pinned base model with an explicit 16-token or greater output ceiling');
  // Requester mode checks the manifest only. Loading model weights and contributing are never enabled.
  const manifestBytes = await readFile(path.join(configuration.models[index].directory, 'manifest.json'));
  requireValue('sha256:' + createHash('sha256').update(manifestBytes).digest('hex') === modelIdentity,
    'Requester model manifest differs from the challenge');
  requireValue(hasReversePromptTemplate(JSON.parse(manifestBytes)), 'Challenge model must declare a Qwen template with thinking disabled');
  // Opening an unconfigured native host normally creates an identity. A game can spend only
  // through its existing dedicated, enrolled identity.
  const requester = JSON.parse(await readOwnFile(configuration.identityFile));
  requireValue(/^peer:[a-f0-9]{24}$/.test(requester?.peerId) && requester.peerId !== providerId,
    'A separate, existing requester identity is required');
  const host = await openFleetNativeHost({ configuration });
  try {
    const enrolled = await host.enrolledRecipients();
    requireValue(host.identity.peerId === requester.peerId && enrolled.has(requester.peerId) && enrolled.has(providerId),
      'The named daily provider and requester must both be enrolled');
    await host.select(index, false);
    const discovery = AbortSignal.timeout(20_000);
    while (!promptRoute(host, pins)) {
      await host.textParticipant.verifyProviders(discovery);
      if (promptRoute(host, pins)) break;
      await delay(250, undefined, { signal: discovery });
    }
    return Object.freeze({
      run: input => runDailyFleet(host, pins, input),
      close: () => host.close()
    });
  } catch (error) {
    await host.close();
    throw error;
  }
}

// The low-level entry point takes a trusted native host. Tests drive the same approval and verification boundaries.
export async function runDailyFleet(host, pins, { prompt, signal = AbortSignal.timeout(60_000), onDispatch }) {
  const { modelId, modelIdentity, providerId, settings } = pins;
  const threadId = randomUUID(), attemptId = randomUUID();
  let approved = false, dispatched = false, requestId;
  try {
    signal.throwIfAborted();
    requireValue(typeof prompt === 'string' && prompt.length > 0 && [...prompt].length <= 240, 'Invalid game prompt');
    requireValue((await host.enrolledRecipients()).has(providerId), 'The daily provider is no longer enrolled');
    const model = promptRoute(host, pins);
    requireValue(model, 'The qualified daily provider is unavailable');
    const messages = [{ role: 'system', content: PROFILE.system }, { role: 'user', content: prompt }];
    const request = { threadId, attemptId, model, messages, settings,
      privacy: createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [providerId] }) };
    const result = await host.runAccountedGeneration(request, { signal,
      requestApproval(preview) {
        signal.throwIfAborted();
        requireValue(!approved && preview.attemptId === attemptId && preview.threadId === threadId
          && preview.modelId === modelId && preview.modelIdentity === modelIdentity
          && preview.recipientIdentity === providerId && same(preview.recipients, [providerId])
          && model.verifiedProviderIdentities[preview.providerId] === providerId && same(preview.adapterIdentities, [])
          && typeof preview.requestId === 'string' && preview.requestId.length > 0
          && preview.admission?.schema === 'reploid.generation-admission/v1' && digest.test(preview.admission.promptCommitment)
          && same(preview.input?.messages, messages) && same(preview.input?.settings, settings),
        'Disclosure differed from the authorized daily attempt');
        approved = true;
        requestId = preview.requestId;
        return true;
      },
      onReservation() { dispatched = true; onDispatch?.(); }
    }, (input, controls) => host.textParticipant.generate(input, controls));
    signal.throwIfAborted();
    const receipt = result.execution?.receipt, settlement = result.serviceCredit;
    requireValue(dispatched && approved && result.threadId === threadId && result.attemptId === attemptId
      && result.modelId === modelId && result.modelIdentity === modelIdentity
      && typeof result.content === 'string' && result.content.length <= 4096
      && result.execution.providerIdentity === providerId && receipt?.version === 3 && receipt.provider === providerId
      && receipt.consumer === host.identity.peerId && receipt.model === modelId && receipt.jobHash === 'request:' + requestId
      && same(receipt.adapterIdentities, []) && receipt.constraintIdentity === undefined
      && Number.isSafeInteger(receipt.outputTokens) && receipt.outputTokens <= PROFILE.maxOutputTokens
      && result.usage?.schema === 'raw-model-tokens/v1' && result.usage.outputTokens === receipt.outputTokens
      && settlement?.id === 'service:' + host.identity.peerId + ':' + requestId
      && (settlement.status === undefined || settlement.status === 'completed')
      && Number.isFinite(settlement.settledAt) && settlement.outputTokens === receipt.outputTokens,
    'The daily result lacks matching execution and settlement evidence');
    const signatures = await verifyReceipt(receipt);
    const settingsDigest = await effectiveRequestDigest({ modelIdentity, messages, settings, adapterIdentities: [] });
    requireValue(signatures.providerValid && signatures.consumerValid
      && await matchesWholeModelReceipt(receipt, messages, { content: result.content, modelIdentity, adapterIdentities: [],
        ownerPolicyDigest: result.ownerPolicyDigest, completion: result.execution.completion }, { settingsDigest }),
    'The daily execution receipt did not verify');
    return { output: result.content, receipt };
  } catch (error) {
    // After approval the credit service may have received dispatch even when this process never received its reply.
    const outcome = error?.disconnect;
    const knownUnsent = outcome?.attemptId === attemptId && outcome.phase === 'queued' && outcome.dispatched === false
      && outcome.finished?.charge === 0 && ['abandoned', 'cancelled_queued'].includes(outcome.finished.status);
    const failure = new Error('Daily inference failed', { cause: error });
    failure.dispatched = dispatched || approved && !knownUnsent;
    throw failure;
  }
}
