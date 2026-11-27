/**
 * The Computers pane: the view records the host's decisions project (apps/poolday/host/decisions/computers.js)
 * and the commands the screens may call. The host owns pairing, accounts, discovery and contribution; these
 * records are its snapshot, never a stronger claim.
 */
export type Tone = 'ready' | 'pending' | 'unavailable';
export type Fact = readonly [term: string, value: string];

/** Computers narrowed to those serving one model, from the Answer on sheet. */
export type ComputersFilter = { readonly providerIds: ReadonlyArray<string>; readonly label: string };

export type FleetPairingView = {
  readonly state: string;
  readonly code: string;
  readonly command: string;
  readonly computer: string;
  readonly fingerprint: string;
  readonly status: string;
  readonly canConfirm: boolean;
  readonly confirmed: boolean;
};

export type FleetAccountView =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly busy: boolean;
      readonly signedIn: boolean;
      readonly hasAccount: boolean;
      readonly status: string;
      readonly starter: string;
      readonly computers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly status: string; readonly removable: boolean }>;
      readonly activityKey: string;
      readonly error: string;
      readonly pairing: FleetPairingView | null;
    };

export type PrivateComputersView =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly connected: boolean;
      readonly hasRequester: boolean;
      readonly status: string;
      readonly error: string;
      readonly activityKey: string;
      readonly computers: ReadonlyArray<{ readonly id: string; readonly name: string; readonly status: string; readonly tone: Tone; readonly facts: ReadonlyArray<Fact> }>;
    };

export type PeerView = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly tone: Tone;
  readonly phase: string;
  readonly state: string;
  readonly model: string;
  readonly hardware: string | null;
  readonly detail: string;
  readonly progress: { readonly value: number; readonly max: number } | null;
  readonly quiet: boolean;
  readonly blocked: boolean;
  /** This page has an open connection a request could be sent on. */
  readonly reachable: boolean;
  /** For the selected model: 'eligible', the reason a request is not sent to this computer, or '' with no whole model selected. */
  readonly eligibility: string;
  /** Reachable, ready for the selected model, and why it is not used, as the host's admission decided them. */
  readonly selection: ReadonlyArray<Fact>;
  /** What it offers, with readiness for each: compute, model files, both, or Nothing. */
  readonly offers: string;
  /** The verified signing identity, when there is one: names and blocks attach to it. */
  readonly identity: string;
  /** Every connection of this computer, the one that names it first (a computer may join as requester and contributor). */
  readonly members: ReadonlyArray<{ readonly id: string; readonly identity: string }>;
  readonly localName: string;
  readonly blockNote: string;
  readonly connection: ReadonlyArray<Fact>;
  readonly usage: ReadonlyArray<Fact>;
  readonly ids: ReadonlyArray<Fact>;
};

export type DeviceView = {
  readonly summary: string;
  readonly localComputer: string;
  readonly supplied: string;
  readonly consumed: string;
  readonly usageScope: string;
  readonly usageError: string;
  readonly sharingSummary: string;
  readonly computeOn: boolean;
  readonly computeLabel: string;
  readonly computeDisabled: boolean;
  /** The file-sharing switch: the same state Settings shows. */
  readonly filesOn: boolean;
  readonly filesLabel: string;
  readonly filesDisabled: boolean;
  /** What this device offers, as the roster states it for other computers. */
  readonly offers: string;
  /** Something is on, so Pause all has an effect. */
  readonly pauseAll: boolean;
  readonly retryStop: boolean;
  readonly retryStopDisabled: boolean;
  readonly progress: string;
  readonly introductions: boolean;
  readonly limits: string;
};

export type ShareableModel = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly disabled: boolean;
  readonly needsSize: boolean;
  readonly label: string;
};

export type ProductionView = {
  readonly attention: boolean;
  readonly error: string;
  readonly local: ReadonlyArray<string>;
  readonly work: string;
  readonly metrics: ReadonlyArray<Fact>;
  readonly progress: { readonly message: string; readonly value: number | null; readonly max: number | null } | null;
  readonly settlement: boolean;
  readonly setup: boolean;
  readonly changeModel: boolean;
  readonly models: ReadonlyArray<ShareableModel>;
  readonly empty: string;
  readonly emptyTitle: string;
  readonly selection: string | null;
  readonly history: {
    readonly count: string;
    readonly status: string;
    readonly records: ReadonlyArray<{ readonly id: string; readonly model: string; readonly at: string; readonly tokens: string }>;
  };
};

export type DiagnosticView =
  | { readonly available: false }
  | {
      readonly available: true;
      readonly busy: boolean;
      readonly measuring: boolean;
      readonly canSave: boolean;
      readonly baselineStored: boolean;
      readonly error: string;
      readonly baseline: string;
      readonly hardware: string;
      readonly result: string;
    };

/** A storage cap the person may choose on Approve; `disabled` when it is smaller than the offer's download. */
export type StorageCapOption = { readonly bytes: number; readonly label: string; readonly disabled: boolean };

/**
 * Weight supply (the host's network.weightSupply, apps/poolday/host/weight-supply-host.js getState), shown only
 * behind the reploid.dev.weight-supply flag until the owner writes its copy. Null when the flag is off or before a
 * connection.
 */
export type WeightSupplyView = {
  /** The unapproved offer: what approving would download, or null. */
  readonly offer: { readonly offerId: string; readonly downloadBytes: number; readonly download: string; readonly pieces: number; readonly expiresAt: number } | null;
  /** The reason code when the last recommendation offered nothing, or null. */
  readonly noOffer: string | null;
  /** A recommendation was computed (an offer or a reason). */
  readonly recommended: boolean;
  readonly approval: { readonly storageCapBytes: number; readonly cap: string; readonly expiresAt: number } | null;
  readonly paused: boolean;
  readonly capOptions: ReadonlyArray<StorageCapOption>;
  /** The largest cap option: the upper bound sent when asking for a recommendation. */
  readonly queryCapBytes: number;
  readonly verified: string;
  readonly served: string;
  readonly servedTransfers: number;
  readonly acquisition: { readonly queuedPieces: number; readonly acquiringPieces: number; readonly failedPieces: number; readonly pending: string };
  readonly busy: boolean;
  readonly error: string;
};

export type ComputersView = {
  readonly connection: { readonly on: boolean; readonly label: string; readonly detail: string; readonly privateScope: boolean };
  readonly filterLabel: string;
  readonly readiness: string;
  readonly peers: ReadonlyArray<PeerView>;
  readonly empty: string;
  readonly quiet: { readonly show: string; readonly hide: string } | null;
  /** The pane's network line: a discovery or action error, the relay notice, or empty. */
  readonly message: string;
  readonly fleet: FleetAccountView;
  readonly privateComputers: PrivateComputersView;
  readonly ownerPairing: { readonly status: string; readonly paired: boolean; readonly busy: boolean; readonly error: string } | null;
  readonly circleInvites: boolean;
  readonly device: DeviceView;
  readonly production: ProductionView;
  readonly diagnostic: DiagnosticView;
  readonly specialized: boolean;
  readonly weightSupply: WeightSupplyView | null;
};

export type CreditActivity = { readonly key: string; readonly text: string; readonly at: string | null };

export type PrivateAccount = {
  readonly own: string;
  readonly activity: ReadonlyArray<CreditActivity> | null;
  readonly others: string;
  readonly hasStatement: boolean;
};

export type GuestInvite = {
  readonly id: string;
  readonly state: string;
  readonly summary: string;
  readonly usage: string;
  readonly queued: string;
  readonly active: boolean;
};

export type InviteLimits = { readonly hours: number; readonly maxRequests: number; readonly maxOutputTokens: number };

export type PairingTarget = { readonly hostParticipantId: string; readonly code: string; readonly hostLabel?: string; readonly roomId?: string };

export type OperationModel = { readonly id: string; readonly label: string };
export type OperationView = { readonly phase: 'idle' | 'starting' | 'sharing' | 'stopping'; readonly status: string };

/** What the composition root supplies to the Computers screens. Every command resolves or rejects with the host's error. */
export type ComputersServices = {
  /** Detaches from the host and stops the work these services started; the screens call it when they go away. */
  readonly dispose: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  /** One view per host notification; the same object until the next one, for a given filter. */
  readonly getView: () => ComputersView;
  readonly setFilter: (filter: ComputersFilter | null) => void;
  /** The selection the composer would send with; each public-network computer is judged against it. */
  readonly setSelectedModel: (selection: string | null) => void;
  readonly network: {
    readonly toggleConnection: () => Promise<unknown>;
    readonly copyInvite: () => Promise<void>;
    readonly setIntroductions: (on: boolean) => Promise<unknown>;
  };
  readonly device: {
    readonly setCompute: (on: boolean) => Promise<unknown>;
    /** Model files from this device's cache, the same switch as Settings' Share model files. */
    readonly setFiles: (on: boolean) => Promise<unknown>;
    /** Turns both off. */
    readonly pauseAll: () => Promise<unknown>;
    readonly retryStop: () => Promise<unknown>;
    /** Cancels a download or stops a model being prepared for sharing. */
    readonly cancelPreparation: () => Promise<unknown>;
  };
  readonly fleet: {
    readonly signIn: (provider: 'google' | 'anonymous') => Promise<unknown>;
    readonly createAccount: () => Promise<unknown>;
    readonly startPairing: () => Promise<unknown>;
    readonly confirmPairing: () => Promise<unknown>;
    readonly useThisComputer: () => Promise<unknown>;
    readonly cancelPairing: () => Promise<unknown>;
    readonly closePairing: () => void;
    readonly revoke: (id: string) => Promise<unknown>;
    readonly activity: () => Promise<ReadonlyArray<CreditActivity>>;
    readonly saveStatement: () => Promise<void>;
  };
  readonly owner: {
    readonly parseLink: (value: string) => PairingTarget | null;
    readonly pair: (target: PairingTarget, options?: { readonly signal?: AbortSignal }) => Promise<{ readonly hostLabel: string }>;
    readonly unpair: () => void;
    readonly transportPath: () => string | null;
    /** The pairing link this page was opened with, if any. */
    readonly linkTarget: () => PairingTarget | null;
    readonly forgetLink: () => void;
  };
  readonly privateComputers: {
    readonly connect: (address: string, secret: string) => Promise<unknown>;
    readonly disconnect: () => Promise<unknown>;
    readonly account: () => Promise<PrivateAccount>;
    readonly saveStatement: () => Promise<void>;
  };
  readonly invites: {
    readonly list: () => Promise<ReadonlyArray<GuestInvite>>;
    readonly issue: (limits: InviteLimits) => Promise<{ readonly id: string; readonly link: string }>;
    readonly revoke: (id: string) => Promise<string>;
    readonly copy: (link: string) => Promise<void>;
  };
  readonly preferences: {
    readonly rename: (peerId: string, name: string, identity: string) => Promise<unknown>;
    readonly setBlocked: (peerId: string, blocked: boolean, identity: string) => Promise<unknown>;
    readonly measure: () => Promise<unknown>;
    readonly cancel: () => void;
    readonly saveBaseline: () => Promise<unknown>;
    readonly clearBaseline: () => Promise<unknown>;
  };
  /** Weight supply's five session commands. Opening never connects; every command needs a connection. */
  readonly weightSupply: {
    /**
     * Asks for one recommendation (with the largest cap option as the upper bound) unless one is in flight, an
     * approval exists or an unexpired offer is shown. Refresh passes `force` to ask again.
     */
    readonly recommend: (options?: { readonly force?: boolean }) => Promise<unknown>;
    /** Approves the shown offer with the cap the person chose; the only place a cap is set. */
    readonly approve: (offerId: string, storageCapBytes: number) => Promise<unknown>;
    /** Under an approval: replace or add pieces within the cap. Without one: a new recommendation. */
    readonly refresh: () => Promise<unknown>;
    /** Pauses weight supply's serving and fetching; Answer requests is not touched. */
    readonly pause: () => Promise<unknown>;
    readonly resume: () => Promise<unknown>;
  };
  readonly operations: {
    readonly models: () => ReadonlyArray<OperationModel>;
    readonly limits: () => string;
    readonly getState: () => OperationView;
    readonly subscribe: (listener: () => void) => () => void;
    readonly start: (selection: { readonly modelId: string } | { readonly file: File }) => Promise<unknown>;
    readonly stop: () => Promise<unknown>;
  };
};
