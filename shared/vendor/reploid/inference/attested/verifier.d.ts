export declare const ATTESTED_PROTOCOL: 'reploid.attested-gpu/v1';
export declare const ATTESTED_BACKEND: 'attested-gpu/v1';
export declare const ATTESTED_EVIDENCE_SCHEMA: 'reploid.attested-gpu-evidence/v1';
export declare const ATTESTED_SESSION_SCHEMA: 'reploid.attested-gpu-session/v1';
export declare const ATTESTED_POLICY_SCHEMA: 'reploid.attested-gpu-policy/v1';
export declare const ATTESTED_PLATFORMS: readonly ['amd-sev-snp', 'intel-tdx'];
export declare const GPU_CC_MODES: readonly ['on', 'off', 'devtools'];
export type AttestationReason = 'evidence-invalid' | 'nonce-mismatch' | 'evidence-stale' | 'platform-unsupported' | 'measurement-unknown' | 'model-mismatch'
  | 'key-unbound' | 'debug-enabled' | 'gpu-not-cc' | 'gpu-measurement-unknown' | 'gpu-count' | 'signature-invalid'
  | 'certificate-expired' | 'certificate-invalid' | 'certificate-revoked' | 'revocation-unchecked' | 'tcb-out-of-date'
  | 'quoting-enclave-unknown' | 'migration-allowed';
export declare const ATTESTATION_REASONS: readonly AttestationReason[];
export declare function attestationRejected(reason: AttestationReason, message: string): Error & { code: 'ATTESTATION_REJECTED'; reason: AttestationReason };
export interface AttestedLaunch { image: string; runtime: { name: string; version: string; digest: string }; model: { id: string; identity: string } }
export interface AttestedPolicy {
  schema: 'reploid.attested-gpu-policy/v1';
  roots: { amdArk: string[]; intelSgxRoot: string[]; nvidiaDevice: string[] };
  launches: Array<{ id: string; platform: 'amd-sev-snp' | 'intel-tdx'; measurement: string | { mrTd: string; rtmr: Array<string | null> };
    launch: AttestedLaunch; label: string; coverage: 'full-image' | 'boot-chain-only' }>;
  gpu: { measurementSets: Array<{ label: string; measurements: Record<string, string> }>; minCount: number; maxCount: number };
  revocation: { gpuOcsp: 'required'; maxOcspAgeMs: number; cpu: 'hook' | 'not-checked' };
  tdxCollateral: 'hook' | 'not-checked'; snp?: { minimumTcb?: { bootloader: number; tee: number; snp: number; microcode: number } };
  /** Intel's TD quoting enclave. Required whenever a launch is `intel-tdx`. */
  tdxQe?: { mrSigner: string[]; isvProdId: number; minIsvSvn: number };
  clockSkewMs: number; maxEvidenceAgeMs: number; maxSessionMs: number; maxCreditsPerOutputToken: number;
}
export interface VerifierHooks {
  checkCpuRevocation?(input: { platform: string; chain: unknown[] }): Promise<{ status: 'good' | 'revoked' | string }>;
  checkTdxCollateral?(input: { quote: unknown; pckChain: unknown[] }): Promise<{ status: 'up-to-date' | string }>;
}
export interface AttestationSummary {
  platform: 'amd-sev-snp' | 'intel-tdx'; launchId: string; launchLabel: string; coverage: 'full-image' | 'boot-chain-only'; launch: AttestedLaunch;
  measurement: string | { mrTd: string; rtmr: string[] }; sessionDigest: string; reportData: string; executorKey: Uint8Array; participantId: string;
  expiresAt: number; gpus: Array<{ index: number; architecture: string; ccMode: 'on'; devToolsMode: false; report: string; measurementSet: string }>;
  rootDigests: { cpu: string; gpu: string }; notChecked: readonly string[];
}
export declare function validateAttestedPolicy(input: unknown): Readonly<AttestedPolicy>;
export declare function attestedPolicyDigest(policy: AttestedPolicy): Promise<string>;
export declare function sessionDigestBytes(session: unknown): Promise<Uint8Array>;
export declare function expectedReportData(sessionDigest: Uint8Array, gpus: unknown[]): Promise<Uint8Array>;
export declare function gpuClaims(gpu: { index: number; architecture: string; ccMode: string; devToolsMode: boolean; report: string }): Promise<Record<string, unknown>>;
export declare function verifyAttestedEvidence(evidence: unknown, options: { policy: AttestedPolicy; expected: { nonce: Uint8Array; model: { id: string; identity: string }; launchId?: string | null };
  now: number; hooks?: VerifierHooks }): Promise<Readonly<AttestationSummary>>;
export declare function spkiDigest(certificate: unknown): Promise<string>;
export declare function parseCertificate(der: Uint8Array): Record<string, unknown>;
export declare function fromHex(text: string): Uint8Array;
