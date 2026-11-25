/** View records for the Computers panel and desktop pairing. Pairing truth stays with the host. */
export type ComputerSummary = {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly tone: 'ready' | 'pending' | 'unavailable';
  readonly toneLabel: string;
};

export type ComputersState = {
  readonly sharing: boolean;
  readonly sharingFiles: boolean;
  readonly thisDeviceStatus: string;
  readonly paired: ReadonlyArray<ComputerSummary>;
  readonly contributors: string;
};

export type PairingState = {
  readonly phase: 'waiting' | 'connected' | 'failed';
  readonly command: string;
  readonly code: string;
  readonly desktop: string | null;
};
