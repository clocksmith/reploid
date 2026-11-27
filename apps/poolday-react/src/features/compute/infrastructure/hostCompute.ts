// Adapts the host's contribution controller (apps/poolday/host/decisions/compute.js) to "Sequence provider". The
// host's contribution session loads, serves, signs and stops; the wording comes from the decisions the vanilla page used.
import * as controllerModule from '../../../../../poolday/host/decisions/compute.js';
import * as resultModule from '../../../../../poolday/host/decisions/run-result.js';
import * as routesModule from '../../../../../poolday/host/decisions/run-routes.js';
import type { Choice, ComputeServices, ComputeSnapshot, Fact } from '../domain/compute';

type Controller = Omit<ComputeServices, 'enrollPasskey'> & { readonly enrollPasskey: () => Promise<void> };
const decisions = controllerModule as unknown as {
  readonly getComputeController: () => Controller;
  readonly projectHealth: (state: object) => ComputeSnapshot['health'];
  readonly projectContribution: (snapshot: object) => ComputeSnapshot['contribution'];
  readonly sharingBoundary: () => ComputeSnapshot['boundary'];
  readonly providerState: (status: string) => ComputeSnapshot['state'];
  readonly LIMIT_BOUNDS: ComputeSnapshot['limitBounds'];
};
const { projectRunResult } = resultModule as unknown as { readonly projectRunResult: (value: unknown) => ComputeSnapshot['result'] };
const routes = routesModule as unknown as {
  readonly DEFAULT_MODEL_ID: string;
  readonly modelChoices: () => ReadonlyArray<Choice>;
  readonly packFacts: (modelId: string) => ReadonlyArray<Fact>;
  readonly workloadLabel: (modelId: string) => string;
};

/** This page's contribution controller; sharing lasts until the person stops or closes the tab. */
export function createComputeServices(): ComputeServices {
  const controller = decisions.getComputeController();
  return { ...controller, enrollPasskey: () => void controller.enrollPasskey() };
}

/** A contributor state the design page shows, read through the host's own projections. */
export type ComputeSpecimen = 'idle' | 'sharing' | 'failed';

const SPECIMEN: Record<ComputeSpecimen, { status: string; health: object; result: unknown; notice: ComputeSnapshot['notice']; recent: ReadonlyArray<object> }> = {
  idle: { status: 'Idle', health: {}, result: null, notice: null, recent: [] },
  sharing: {
    status: 'Available', health: { webgpu: 'available', model: 'loaded', queue: 'listening', lastReceipt: 'sha256:5f1e0c3a7b9d24e8', capability: 'sequence_embedding', storage: '412/8192 MB' },
    result: { runner: 'peer_room_listening', relay: 'local', roomId: 'reploid-default' }, notice: null,
    recent: [{ receiptHash: 'sha256:5f1e0c3a7b9d24e8a6c1f0b3d5e7a9c2', modelId: routes.DEFAULT_MODEL_ID, tokens: 15, roomId: 'reploid-default' }],
  },
  failed: {
    status: 'Could not start', health: { webgpu: 'available', model: 'load_failed', queue: 'stopped' },
    result: { status: 'error', error: 'This tab could not start', reason: 'Model failed to load', action: 'Load a compatible model first.' },
    notice: { state: 'error', title: 'Model failed to load', message: 'Nothing was shared. Check the model files, then start again.' }, recent: [],
  },
};

/** A fixed "Sequence provider" page for the design page: the shipped projections over a recorded state; its commands change nothing. */
export function computeSpecimenServices(kind: ComputeSpecimen): ComputeServices {
  const fixture = SPECIMEN[kind];
  const sharing = kind === 'sharing';
  const snapshot: ComputeSnapshot = {
    status: fixture.status, state: decisions.providerState(fixture.status), notice: fixture.notice, room: { id: 'reploid-default', relay: 'local' },
    active: sharing, starting: false, stopping: false, modelId: routes.DEFAULT_MODEL_ID, modelLocked: sharing,
    models: routes.modelChoices(), workload: routes.workloadLabel(routes.DEFAULT_MODEL_ID), facts: routes.packFacts(routes.DEFAULT_MODEL_ID),
    boundary: decisions.sharingBoundary(),
    permissions: { relayArtifacts: true, verifyResults: true },
    limits: { maxConcurrentJobs: 1, maxTokensPerJob: 256, storageBudgetMiB: 1024, bandwidthBudgetMbps: 25 }, limitBounds: decisions.LIMIT_BOUNDS,
    health: decisions.projectHealth({ webgpu: 'unknown', model: 'not_loaded', artifact: 'not_checked', storage: 'unknown', queue: 'idle', lastReceipt: 'none', trust: 'signed_record', reputation: 'not_loaded', ...fixture.health }),
    contribution: decisions.projectContribution({ optedIn: sharing, label: sharing ? 'Available' : 'Not active', modelId: sharing ? routes.DEFAULT_MODEL_ID : null,
      contributions24h: fixture.recent.length, tokens24h: sharing ? 15 : 0, tokensHour: sharing ? 15 : 0, recent: fixture.recent }),
    identity: { label: 'ID 8e2f47…d905', protection: 'browser_non_exportable', title: 'Non-exportable browser device key' },
    passkey: { label: 'Protect identity with passkey', disabled: false, status: '' },
    result: projectRunResult(fixture.result),
  };
  const still = () => undefined;
  return { getSnapshot: () => snapshot, subscribe: () => still, toggle: still, setModel: still, setPermission: still, setLimit: still, enrollPasskey: still };
}
