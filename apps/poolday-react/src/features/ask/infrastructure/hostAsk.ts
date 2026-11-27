// Adapts the host's run controller (apps/poolday/host/decisions/ask.js) to "Run a model". The host's peer run
// session signs, routes, verifies and saves; the wording comes from the same decisions the vanilla page used.
import * as controllerModule from '../../../../../poolday/host/decisions/ask.js';
import * as resultModule from '../../../../../poolday/host/decisions/run-result.js';
import * as routesModule from '../../../../../poolday/host/decisions/run-routes.js';
import type { AskServices, AskSnapshot, Choice, Fact, RunResultView } from '../domain/ask';

type Controller = Omit<AskServices, 'copyEmbedding'> & { readonly copyEmbedding: () => Promise<void> };
const { getAskController, roomContext } = controllerModule as unknown as {
  readonly getAskController: () => Controller;
  readonly roomContext: () => AskSnapshot['room'];
};
const { projectRunResult } = resultModule as unknown as { readonly projectRunResult: (value: unknown) => Omit<RunResultView, 'answerHidden'> };
const routes = routesModule as unknown as {
  readonly DEFAULT_MODEL_ID: string;
  readonly modelChoices: () => ReadonlyArray<Choice>;
  readonly policyChoices: () => ReadonlyArray<Choice>;
  readonly packFacts: (modelId: string) => ReadonlyArray<Fact>;
  readonly workloadLabel: (modelId: string) => string;
};

/** This page's run controller; it lives as long as the page. */
export function createAskServices(): AskServices {
  const controller = getAskController();
  return { ...controller, copyEmbedding: () => void controller.copyEmbedding() };
}

/** A run outcome the design page shows, read through the host's own result projection. */
export type AskSpecimen = 'ready' | 'answered' | 'no-provider';

const SPECIMEN_RESULTS: Record<AskSpecimen, unknown> = {
  ready: null,
  answered: {
    status: 'completed', transport: 'webrtc_peer_room', policyId: 'redundant_agreement', outputText: 'Pooled embedding · 480 values',
    receiptHash: 'sha256:5f1e0c3a7b9d24e8a6c1f0b3d5e7a9c2b4d6f8e0a1c3e5', agreement: { accepted: true, acceptedProviderCount: 2, requiredAgreement: 2 },
    assignments: [{ providerId: 'provider:3c9a51e2d7b04f6a', assignmentId: 'assignment:1' }, { providerId: 'provider:8e2f47b1c6a3d905', assignmentId: 'assignment:2' }]
  },
  'no-provider': {
    status: 'error', statusLabel: 'No provider', error: 'No matching provider is currently available', reason: 'peer_provider_not_found',
    action: 'The request is preserved. Choose a recovery option below.',
    recovery: { kind: 'provider_missing', title: 'No matching browser is ready', message: 'No contributor in "reploid-default" is currently advertising ESM-2 35M (Protein). Run here without sharing compute, or keep searching.',
      actions: [{ id: 'retry_network', label: 'Keep searching', primary: true }, { id: 'offer_local_provider', label: 'Run on this device' }, { id: 'invite_contributor', label: 'Invite a contributor', href: '/compute?room=reploid-default' }] }
  }
};
const SPECIMEN_RUN: Record<AskSpecimen, AskSnapshot['run']> = {
  ready: { state: 'idle', phase: '', message: 'Ready' },
  answered: { state: 'complete', phase: 'answer', message: 'Protein embedding verified' },
  'no-provider': { state: 'error', phase: 'match', message: 'No matching provider is currently available' },
};

/** A fixed "Run a model" page for the design page: the shipped projection over a recorded outcome; its commands change nothing. */
export function askSpecimenServices(kind: AskSpecimen): AskServices {
  const result = projectRunResult(SPECIMEN_RESULTS[kind]);
  const snapshot: AskSnapshot = {
    form: { prompt: 'MAPLALLLLGLVAGA', modelId: routes.DEFAULT_MODEL_ID, policyId: 'fastest_receipt', sequencePublic: kind !== 'ready' },
    busy: false, run: SPECIMEN_RUN[kind], outputVisible: kind !== 'ready',
    models: routes.modelChoices(), policies: routes.policyChoices(), workload: routes.workloadLabel(routes.DEFAULT_MODEL_ID), facts: routes.packFacts(routes.DEFAULT_MODEL_ID),
    canRequest: true, identity: { label: 'ID 3c9a51…f6a0', protection: 'browser_non_exportable', title: 'Non-exportable browser device key' },
    room: roomContext(), result: { ...result, answerHidden: !!result.recovery }, copyStatus: '',
  };
  const still = () => undefined;
  return { getSnapshot: () => snapshot, subscribe: () => still, setPrompt: still, setModel: still, setPolicy: still, setSequencePublic: still, run: still, recover: still, copyEmbedding: still };
}
