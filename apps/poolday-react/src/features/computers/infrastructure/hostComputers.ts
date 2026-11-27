// Adapts the Poolday host's computers, pairing, accounts, discovery and contribution to the Computers screens.
// Every line comes from apps/poolday/host/decisions/computers.js, the decisions the vanilla pane used; this
// file only reads host snapshots, calls host commands and hands files to the browser.
import * as host$ from '../../../../../poolday/host/decisions/computers.js';
import * as ownerPairingHost from '../../../../../poolday/host/owner-pairing.js';
import { createProjectedStore } from '../../../../../poolday/host/decisions/projected-store.js';
import type {
  ComputersFilter,
  ComputersServices,
  ComputersView,
  CreditActivity,
  GuestInvite,
  OperationView,
  PairingTarget,
  WeightSupplyView,
} from '../domain/services';

/** weight-supply-host.js getState: the fields the Contribute view reads. */
type WeightSupplyState = {
  readonly recommendation: {
    readonly offer: { readonly offerId: string; readonly totalDownloadBytes: number; readonly pieces: ReadonlyArray<unknown>; readonly expiresAt: number } | null;
    readonly noOffer: string | null;
  } | null;
  readonly approval: { readonly storageCapBytes: number; readonly expiresAt: number } | null;
  readonly paused: boolean;
  readonly verifiedBytes: number;
  readonly servedBytes: number;
  readonly servedTransfers: number;
  readonly acquisition: { readonly queuedPieces: number; readonly acquiringPieces: number; readonly failedPieces: number; readonly pendingBytes: number };
  readonly transfers?: ReadonlyArray<{ readonly transferId: string; readonly pieceId: string; readonly deliveredBytes: number;
    readonly roles?: { readonly consumer?: { readonly connectionId?: string | null } } }>;
  readonly error: string | null;
};
type State = Record<string, unknown> & {
  readonly network?: {
    readonly computeEnabled?: boolean;
    readonly sharing?: boolean;
    readonly introductionAssistance?: boolean;
    readonly paused?: boolean;
    readonly weightSupply?: WeightSupplyState | null;
  };
};
type Statement = unknown;
type FleetPort = {
  readonly state: () => unknown;
  readonly signIn: (provider: string) => Promise<unknown>;
  readonly createAccount: () => Promise<unknown>;
  readonly startPairing: () => Promise<unknown>;
  readonly confirmPairing: () => Promise<unknown>;
  readonly useThisComputer: () => Promise<unknown>;
  readonly cancelPairing: () => Promise<unknown>;
  readonly closePairing: () => void;
  readonly revoke: (id: string) => Promise<unknown>;
  readonly statement: () => Promise<Statement>;
  readonly reread: () => Promise<unknown>;
  readonly load?: () => Promise<unknown>;
};
type PrivatePort = {
  readonly state: () => { readonly connected?: boolean; readonly requester?: { readonly id?: string } | null; readonly models?: ReadonlyArray<{ readonly id: string; readonly name?: string }> };
  readonly connect: (address: string, secret: string) => Promise<unknown>;
  readonly disconnect: () => Promise<unknown>;
  readonly accounts: () => Promise<unknown>;
  readonly statement?: () => Promise<Statement>;
};
type InviteRow = { inviteId: string; status: string; expiresAt: number; guestPeerId?: string; hostLabel?: string; hostPeerId?: string;
  activeRequests?: number; usedRequests: number; maxRequests: number; queuedRequests?: number | null };
type InvitePort = {
  readonly list: () => Promise<ReadonlyArray<InviteRow>>;
  readonly issue: (limits: { expiresAt: number; maxRequests: number; maxOutputTokens: number }) => Promise<{ inviteId: string; link: string }>;
  readonly revoke: (id: string) => Promise<{ revocationPolicy?: string } | undefined>;
};
type OwnerPort = {
  readonly state: () => { readonly transportPath?: string | null };
  readonly pair: (target: PairingTarget & { signal?: AbortSignal }) => Promise<{ hostLabel: string }>;
  readonly unpair: () => void;
};
type Session = {
  readonly getState: () => State;
  readonly subscribe: (listener: (state: State) => void) => () => void;
  readonly connect?: () => Promise<unknown>;
  readonly disconnect?: () => Promise<unknown>;
  readonly setIntroductionAssistance?: (on: boolean) => unknown;
  readonly setComputeContribution?: (on: boolean) => Promise<unknown>;
  readonly setCachedFileContribution?: (on: boolean) => Promise<unknown>;
  readonly setSharing?: (on: boolean, selection: string | null, approved: boolean) => Promise<unknown>;
  readonly recommendWeightSupply?: (options: { storageCapBytes: number }) => Promise<unknown>;
  readonly approveWeightSupply?: (options: { offerId: string; storageCapBytes: number }) => Promise<unknown>;
  readonly refreshWeightSupply?: () => Promise<unknown>;
  readonly pauseWeightSupply?: () => Promise<unknown>;
  readonly resumeWeightSupply?: () => Promise<unknown>;
  readonly cancelModelDownload?: () => unknown;
  readonly getModelDownload?: (id: string, options: { signal: AbortSignal }) => Promise<{ sizeBytes?: number }>;
  readonly fleetAccount?: FleetPort | null;
  readonly privateComputers?: PrivatePort | null;
  readonly ownerPairing?: OwnerPort | null;
  readonly circleInvites?: InvitePort | null;
};
type Preferences = {
  readonly getState: () => { readonly names: Record<string, string>; readonly blocked: ReadonlyArray<string> } & Record<string, unknown>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly rename: (id: string, name: string, options: { participantId: string }) => Promise<unknown>;
  readonly block: (id: string, options: { participantId: string | null }) => Promise<unknown>;
  readonly unblock: (id: string, options: { participantId: string | null }) => unknown;
  readonly measure: (options: { consent: true }) => Promise<unknown>;
  readonly cancel: () => void;
  readonly saveBaseline: () => Promise<unknown>;
  readonly clearBaseline: () => Promise<unknown>;
};
type Participation = {
  readonly getState: () => { phase: OperationView['phase']; modelId?: string; error?: string };
  readonly start: (selection: object) => Promise<unknown>;
  readonly stop: () => Promise<unknown>;
  readonly subscribe?: (listener: () => void) => () => void;
};
type Host = {
  readonly chat?: Session;
  readonly computers?: Preferences | null;
  readonly swarm?: { readonly getInviteUrl?: () => string };
  readonly operationSharing?: Participation;
};

const { parseOwnerPairingUrl } = ownerPairingHost as unknown as { readonly parseOwnerPairingUrl: (value: string) => PairingTarget | null };

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
const activityRows = (rows: ReadonlyArray<{ at: number; requestId: string; text: string }>): CreditActivity[] =>
  rows.map((row, index) => ({ key: `${row.requestId ?? index}:${index}`, text: row.text, at: Number.isFinite(row.at) ? new Date(row.at).toLocaleString() : null }));

/** Saves JSON the person asked for, as a file download. */
function saveJson(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Weight supply shows only behind this flag until the owner writes its copy: localStorage['reploid.dev.weight-supply'] = '1'. */
export const WEIGHT_SUPPLY_FLAG = 'reploid.dev.weight-supply';
const weightSupplyFlag = () => {
  try {
    return window.localStorage.getItem(WEIGHT_SUPPLY_FLAG) === '1';
  } catch {
    return false;
  }
};

const MIB = 1024 * 1024;
/** The caps the person may choose on Approve. The largest is only the upper bound sent when asking for an offer. */
export const STORAGE_CAP_OPTIONS: ReadonlyArray<number> = [16 * MIB, 64 * MIB, 256 * MIB, 1024 * MIB];
const QUERY_CAP_BYTES = Math.max(...STORAGE_CAP_OPTIONS);
const bytesText = (value: number) => (value >= 1024 * MIB ? `${(value / (1024 * MIB)).toFixed(1)} GiB` : `${(value / MIB).toFixed(1)} MiB`);

let weightSupplyCache: { key: string; view: WeightSupplyView } | null = null;
function weightSupplyView(state: WeightSupplyState, busy: boolean, error: string): WeightSupplyView {
  const key = JSON.stringify([state, busy, error]);
  if (weightSupplyCache?.key === key) return weightSupplyCache.view;
  const offer = state.recommendation?.offer ?? null;
  const downloadBytes = offer?.totalDownloadBytes ?? 0;
  const view: WeightSupplyView = {
    offer: offer && { offerId: offer.offerId, downloadBytes, download: bytesText(downloadBytes), pieces: offer.pieces.length, expiresAt: offer.expiresAt },
    noOffer: state.recommendation?.noOffer ?? null,
    recommended: Boolean(state.recommendation),
    approval: state.approval && { storageCapBytes: state.approval.storageCapBytes, cap: bytesText(state.approval.storageCapBytes), expiresAt: state.approval.expiresAt },
    paused: state.paused,
    capOptions: STORAGE_CAP_OPTIONS.map((bytes) => ({ bytes, label: bytesText(bytes), disabled: !offer || bytes < downloadBytes })),
    queryCapBytes: QUERY_CAP_BYTES,
    verifiedBytes: state.verifiedBytes,
    verified: bytesText(state.verifiedBytes),
    transfers: (state.transfers ?? []).map((row) => ({ id: row.transferId, pieceId: row.pieceId, deliveredBytes: row.deliveredBytes,
      consumer: row.roles?.consumer?.connectionId ?? '' })),
    served: bytesText(state.servedBytes),
    servedTransfers: state.servedTransfers,
    acquisition: { queuedPieces: state.acquisition.queuedPieces, acquiringPieces: state.acquisition.acquiringPieces,
      failedPieces: state.acquisition.failedPieces, pending: bytesText(state.acquisition.pendingBytes) },
    busy,
    error: error || state.error || '',
  };
  weightSupplyCache = { key, view };
  return view;
}

const EMPTY_SESSION: Session ={ getState: () => ({}), subscribe: () => () => undefined };

export function createComputersServices(product: { readonly host: object; readonly earning: Promise<unknown> }): ComputersServices {
  const host = product.host as Host;
  const session = host.chat ?? EMPTY_SESSION;
  const preferences = host.computers ?? null;
  const sizes = new Map<string, { sizeBytes?: number; error?: string }>();
  const sizeRequests = new AbortController();
  let filter: ComputersFilter | null = null;
  let selected: string | null = null;
  let actionError = '';
  let notice = '';
  let fleetKey = '';
  let weightBusy = false;
  let weightError = '';
  let recommending: Promise<unknown> | null = null;
  // Declared before the store reads them through attach and project.
  const changed = () => store.changed();

  // The participation module is created on first read; read it only once the pane asks for it.
  const participation = () => {
    try {
      return host.operationSharing ?? null;
    } catch {
      return null;
    }
  };

  const requestSizes = (state: State, production: ComputersView['production']) => {
    if (!session.getModelDownload || (state as { localDownloadIssue?: string }).localDownloadIssue) return;
    for (const model of production.models) {
      if (!model.needsSize || sizes.has(model.id)) continue;
      const entry: { sizeBytes?: number; error?: string } = {};
      sizes.set(model.id, entry);
      Promise.resolve()
        .then(() => session.getModelDownload?.(model.id, { signal: sizeRequests.signal }))
        .then((info) => {
          if (!Number.isSafeInteger(info?.sizeBytes) || (info?.sizeBytes ?? 0) <= 0) throw new Error('Download size unavailable');
          entry.sizeBytes = info?.sizeBytes;
        })
        .catch((cause: unknown) => {
          entry.error = messageOf(cause);
        })
        .finally(() => {
          if (!sizeRequests.signal.aborted) changed();
        });
    }
  };

  const project = (): ComputersView => {
    const prefs = preferences?.getState();
    if (prefs) {
      host$.setComputerNames(session, prefs.names);
      host$.setBlockedComputers(session, prefs.blocked);
    }
    const state = host$.withComputerLabels(session.getState(), session);
    const base = host$.projectComputers(state, { filter, sizes, selected, ...(prefs ? { names: prefs.names } : {}) });
    requestSizes(state, base.production);
    const issue = base.networkIssue || actionError;
    const { networkIssue: _unused, ...rest } = base;
    void _unused;
    return {
      ...rest,
      message: notice || issue || (host$.relayUnavailableReason() ? host$.RELAY_UNAVAILABLE_TEXT : ''),
      fleet: host$.projectFleetAccount(session.fleetAccount),
      circleInvites: Boolean(session.circleInvites),
      diagnostic: host$.projectDiagnostic(prefs ?? null),
      // `in`, not a read: reading the getter starts the participation module.
      specialized: 'operationSharing' in host,
      weightSupply: weightSupplyFlag() && state.network?.weightSupply ? weightSupplyView(state.network.weightSupply, weightBusy, weightError) : null,
    };
  };

  /** The balance moves as answers settle: re-read when this pool's work changes, and every 5 s while open. */
  const rereadFleet = (state: State) => {
    const fleet = session.fleetAccount;
    if (!fleet) return;
    const key = JSON.stringify(((state.privateComputers as { computers?: Array<{ id: string; activeRequests?: number }> } | undefined)?.computers ?? []).map((row) => [row.id, row.activeRequests ?? 0]));
    if (key !== fleetKey) {
      fleetKey = key;
      void fleet.reread().catch(() => undefined);
    }
  };

  const attach = () => {
    const offSession = session.subscribe((state) => {
      rereadFleet(state);
      changed();
    });
    const offPreferences = preferences?.subscribe(changed) ?? (() => undefined);
    window.addEventListener('reploid:relay-state', changed);
    void session.fleetAccount?.load?.()?.catch?.(() => undefined);
    const timer = setInterval(() => {
      if (!document.hidden) void session.fleetAccount?.reread().catch(() => undefined);
    }, 5000);
    return () => {
      offSession();
      offPreferences();
      window.removeEventListener('reploid:relay-state', changed);
      clearInterval(timer);
    };
  };
  const store = createProjectedStore({ attach, project });

  /** A network action: its error shows on the pane's network line until the next action. */
  const act = async <T>(work: () => Promise<T> | T): Promise<T | undefined> => {
    actionError = '';
    notice = '';
    changed();
    try {
      return await work();
    } catch (cause) {
      actionError = messageOf(cause);
      changed();
      return undefined;
    }
  };

  const need = <T>(value: T | null | undefined, what: string): T => {
    if (value === null || value === undefined) throw new Error(`${what} is unavailable`);
    return value;
  };

  /** A weight-supply command: busy until it settles; its error shows in the weight-supply block. */
  const weightAct = async (work: () => Promise<unknown>) => {
    weightBusy = true;
    weightError = '';
    changed();
    try {
      return await work();
    } catch (cause) {
      weightError = messageOf(cause);
      return undefined;
    } finally {
      weightBusy = false;
      changed();
    }
  };
  const weightState = () => (session.getState() as State).network?.weightSupply ?? null;
  /** One request at a time; without `force`, none under an approval or while an unexpired offer is shown. */
  const recommend = (force: boolean) => {
    if (recommending) return recommending;
    const current = weightState();
    if (!current) return Promise.resolve(undefined);
    const offer = current.recommendation?.offer;
    if (!force && (current.approval || (offer && offer.expiresAt > Date.now()))) return Promise.resolve(undefined);
    recommending = weightAct(() => need(session.recommendWeightSupply, 'Weight supply').call(session, { storageCapBytes: QUERY_CAP_BYTES })).finally(() => {
      recommending = null;
    });
    return recommending;
  };

  return {
    dispose() {
      store.dispose();
      sizeRequests.abort();
    },
    subscribe: store.subscribe,
    getView: store.getSnapshot,
    setFilter(next) {
      if (next === filter || (next && filter && next.label === filter.label && next.providerIds.join('\n') === filter.providerIds.join('\n'))) return;
      filter = next;
      changed();
    },
    setSelectedModel(next) {
      if (next === selected) return;
      selected = next;
      changed();
    },
    network: {
      toggleConnection: () =>
        act(() => {
          const on = projectView().connection.on;
          return on ? need(session.disconnect, 'Peer disconnection').call(session) : need(session.connect, 'Network connection').call(session);
        }),
      copyInvite: async () => {
        await act(async () => {
          const getInviteUrl = host.swarm?.getInviteUrl;
          if (!getInviteUrl) throw new Error('Mesh invitation is unavailable');
          await navigator.clipboard.writeText(getInviteUrl.call(host.swarm));
          notice = 'Invite copied';
          changed();
        });
      },
      setIntroductions: (on) => act(() => need(session.setIntroductionAssistance, 'Introduction assistance').call(session, on)),
    },
    device: {
      setCompute: (on) => act(() => need(session.setComputeContribution, 'Compute contribution').call(session, on)),
      setFiles: (on) => act(() => need(session.setCachedFileContribution, 'File sharing').call(session, on)),
      pauseAll: () => act(async () => {
        const device = projectView().device;
        if (device.computeOn) await need(session.setComputeContribution, 'Compute contribution').call(session, false);
        if (device.filesOn) await need(session.setCachedFileContribution, 'File sharing').call(session, false);
      }),
      retryStop: () => act(() => need(session.setComputeContribution, 'Compute contribution').call(session, false)),
      cancelPreparation: async () => {
        if (host$.preparationCancel(session.getState()) === 'cancel-download') return session.cancelModelDownload?.();
        return need(session.setSharing, 'Sharing').call(session, false, projectView().production.selection, false);
      },
    },
    weightSupply: {
      recommend: (options) => recommend(options?.force === true),
      approve: (offerId, storageCapBytes) => weightAct(() => need(session.approveWeightSupply, 'Weight supply').call(session, { offerId, storageCapBytes })),
      refresh: () => (weightState()?.approval ? weightAct(() => need(session.refreshWeightSupply, 'Weight supply').call(session)) : recommend(true)),
      pause: () => weightAct(() => need(session.pauseWeightSupply, 'Weight supply').call(session)),
      resume: () => weightAct(() => need(session.resumeWeightSupply, 'Weight supply').call(session)),
    },
    fleet: {
      signIn: (provider) => need(session.fleetAccount, 'The account').signIn(provider),
      createAccount: () => need(session.fleetAccount, 'The account').createAccount(),
      startPairing: () => need(session.fleetAccount, 'The account').startPairing(),
      confirmPairing: () => need(session.fleetAccount, 'The account').confirmPairing(),
      useThisComputer: () => need(session.fleetAccount, 'The account').useThisComputer(),
      cancelPairing: () => need(session.fleetAccount, 'The account').cancelPairing(),
      closePairing: () => session.fleetAccount?.closePairing(),
      revoke: (id) => need(session.fleetAccount, 'The account').revoke(id),
      activity: async () => {
        try {
          return activityRows(host$.creditActivity(await need(session.fleetAccount, 'The account').statement()));
        } catch (cause) {
          if ((cause as { code?: string })?.code === 'no_computers') return [];
          throw cause;
        }
      },
      saveStatement: async () => saveJson(await need(session.fleetAccount, 'The account').statement(), 'reploid-account-statement.json'),
    },
    owner: {
      parseLink: (value) => parseOwnerPairingUrl(value),
      pair: (target, { signal } = {}) => need(session.ownerPairing, 'Desktop pairing').pair({ ...target, ...(signal ? { signal } : {}) }),
      unpair: () => session.ownerPairing?.unpair(),
      transportPath: () => session.ownerPairing?.state().transportPath ?? null,
      linkTarget: () => (session.ownerPairing ? parseOwnerPairingUrl(window.location.href) : null),
      forgetLink: () => {
        if (parseOwnerPairingUrl(window.location.href)) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
      },
    },
    privateComputers: {
      connect: (address, secret) => need(session.privateComputers, 'Private computers').connect(address, secret),
      disconnect: () => need(session.privateComputers, 'Private computers').disconnect(),
      account: async () => {
        const port = need(session.privateComputers, 'Private computers');
        const fleet = port.state();
        const [snapshot, statement] = await Promise.all([port.accounts(), port.statement?.().catch(() => null) ?? null]);
        const { own, others } = host$.creditAccounts(snapshot, fleet.requester?.id);
        const modelName = (id: string) => fleet.models?.find((model) => model.id === id)?.name || id;
        return {
          own: own ? `Your account (${own.name}): ${host$.accountText(own)}` : 'This host’s account was not reported.',
          activity: statement ? activityRows(host$.creditActivity(statement, { modelName })) : null,
          others: others.length ? `Other enrolled accounts: ${others.map((row) => `${row.name} · ${host$.accountText(row)}`).join('; ')}` : '',
          hasStatement: Boolean(statement),
        };
      },
      saveStatement: async () => {
        const port = need(session.privateComputers, 'Private computers');
        saveJson(await need(port.statement, 'The statement').call(port), 'reploid-service-statement.json');
      },
    },
    invites: {
      list: async () => (await need(session.circleInvites, 'Guest links').list()).map(inviteView),
      issue: async ({ hours, maxRequests, maxOutputTokens }) => {
        const invite = await need(session.circleInvites, 'Guest links').issue({ expiresAt: Date.now() + hours * 3600000, maxRequests, maxOutputTokens });
        return { id: invite.inviteId, link: invite.link };
      },
      revoke: async (id) => {
        const result = await need(session.circleInvites, 'Guest links').revoke(id);
        return result?.revocationPolicy === 'stop'
          ? 'Invite revoked. Running answers were stopped with no duplicate settlement.'
          : 'Invite revoked. Answers already running can finish.';
      },
      copy: (link) => navigator.clipboard.writeText(link),
    },
    preferences: {
      rename: (peerId, name, identity) => need(preferences, 'Computer preferences').rename(peerId, name, { participantId: identity }),
      setBlocked: async (peerId, blocked, identity) => {
        const store = need(preferences, 'Computer preferences');
        const participantId = identity || null;
        if (blocked) await store.block(peerId, { participantId });
        else store.unblock(peerId, { participantId });
      },
      measure: () => need(preferences, 'Computer preferences').measure({ consent: true }),
      cancel: () => preferences?.cancel(),
      saveBaseline: () => need(preferences, 'Computer preferences').saveBaseline(),
      clearBaseline: () => need(preferences, 'Computer preferences').clearBaseline(),
    },
    operations: {
      models: () => host$.operationModels().map((model) => ({ id: model.modelId, label: model.label || model.modelId })),
      limits: () => host$.operationLimitsText(),
      getState: () => operationView(participation()),
      // The participation module reports changes only to the page that opened it; poll while the pane listens.
      subscribe: (listener) => {
        const own = participation()?.subscribe?.(listener);
        if (own) return own;
        let last = JSON.stringify(operationView(participation()));
        const timer = setInterval(() => {
          const next = JSON.stringify(operationView(participation()));
          if (next !== last) {
            last = next;
            listener();
          }
        }, 500);
        return () => clearInterval(timer);
      },
      start: async (selection) => {
        const port = need(participation(), 'Specialized model jobs');
        const choice = 'modelId' in selection ? { modelId: selection.modelId } : { file: selection.file };
        return port.start(await host$.operationSelection({ ...choice, approved: selection.approved }));
      },
      stop: () => need(participation(), 'Specialized model jobs').stop(),
    },
  };

  function projectView() {
    return store.getSnapshot();
  }
}

let operationCache: { key: string; view: OperationView } | null = null;
function operationView(port: Participation | null): OperationView {
  const state = port?.getState() ?? { phase: 'idle' as const };
  const status = host$.operationStatusText(state);
  const key = `${state.phase}\n${status}`;
  if (operationCache?.key !== key) operationCache = { key, view: { phase: state.phase, status } };
  return operationCache.view;
}

function inviteView(row: InviteRow): GuestInvite {
  const host = row.hostLabel && row.hostLabel !== row.hostPeerId ? ` · ${row.hostLabel}` : '';
  const running = row.activeRequests ? ` · ${row.activeRequests} running` : '';
  return {
    id: row.inviteId,
    state: row.status,
    summary: `${row.guestPeerId || 'Waiting for guest'} · ${row.status}${host}`,
    usage: `${row.usedRequests} of ${row.maxRequests} requests used · expires ${new Date(row.expiresAt).toLocaleString()}${running}`,
    queued: row.queuedRequests == null ? '' : `${row.queuedRequests} queued`,
    active: row.status === 'active',
  };
}
