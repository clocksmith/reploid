export interface SignedResidentSession {
  verification: unknown;
  residentPartition: {
    tokenize(request: unknown): Promise<unknown>;
    executeGroup0(request: unknown): Promise<unknown>;
    executeGroup1(request: unknown): Promise<unknown>;
    close(): Promise<void>;
    [key: string]: unknown;
  };
  close(): Promise<void>;
  [key: string]: unknown;
}
export function createSignedResidentFactory<T>(options: {
  createFactory(binding: { capsuleOptions: Record<string, unknown>;
    openCapsule(capsule: unknown, options: unknown): Promise<SignedResidentSession> }): T;
  openCapsule(capsule: unknown, options: unknown): Promise<SignedResidentSession>;
  model: unknown; artifactStore: unknown; canonical?:boolean;
  release: { options: Record<string, unknown>; assertCurrent(session: SignedResidentSession): Promise<void> };
  assertSession(model: unknown, session: SignedResidentSession): Promise<void>;
  closeSources(failures: unknown[]): Promise<void>;
  trackSession(session: SignedResidentSession): () => void;
  onVerification?(verification: unknown): void;
  /** Capsule `onLoadProgress`; Doppler reports pipeline preparation through it before readiness. */
  onLoadProgress?: ((event: unknown) => void) | null;
}): T;
