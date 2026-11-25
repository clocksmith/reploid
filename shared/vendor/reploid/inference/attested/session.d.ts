import type { AttestedPolicy, AttestationSummary, VerifierHooks } from './verifier.js';
export interface AttestedFrame { header: { schema: 'reploid.attested-gpu/v1'; kind: string; blobs: number[]; [key: string]: unknown }; blobs: Uint8Array[] }
export interface FrameChannel { send(frame: AttestedFrame): Promise<void>; receive(options?: { timeoutMs?: number }): Promise<AttestedFrame>; close(): void }
export declare const ATTESTED_FRAME_CEILINGS: Readonly<Record<string, number>>;
export declare const ATTESTED_EXECUTOR_ERRORS: readonly string[];
export declare function attestedSessionError(code: string, message: string): Error & { code: string };
export declare function inspectAttestedHeader(header: unknown): number[];
export interface AttestedAnswer { text: string; finishReason?: string; stopReason?: string | null; usage: { inputTokens: number; outputTokens: number } }
export declare function runAttestedRequesterSession(input: {
  channel: FrameChannel; policy: AttestedPolicy; model: { id: string; identity: string }; launchId?: string | null; requestId: string;
  messages: Array<{ role: string; content: string }>; generation: { maxOutputTokens?: number | null }; now?: () => number; hooks?: VerifierHooks;
  timeoutMs?: number; generationTimeoutMs?: number; signal?: AbortSignal; onAttested?(summary: AttestationSummary): unknown; onDelta?(text: string): void;
}): Promise<{ output: { text: string; finishReason: string; stopReason: string | null }; usage: { inputTokens: number; outputTokens: number };
  timing: Record<string, unknown> | null; attestation: AttestationSummary; frames: { sent: number; received: number; bytesSent: number; bytesReceived: number } }>;
export interface AttestedHost {
  participantId: string; platform: 'amd-sev-snp' | 'intel-tdx'; launch: { image: string; runtime: { name: string; version: string; digest: string }; model: { id: string; identity: string } };
  collectGpuEvidence(nonce: Uint8Array): Promise<Array<{ index: number; architecture: string; ccMode: string; devToolsMode: boolean; report: Uint8Array; certificates: Uint8Array[]; ocsp: Uint8Array[] }>>;
  collectCpuEvidence(reportData: Uint8Array): Promise<{ report: Uint8Array; certificates: Uint8Array[] }>;
  generate(input: { messages: Array<{ role: string; content: string }>; generation: { maxOutputTokens?: number }; signal?: AbortSignal; onDelta(text: string): void }): Promise<AttestedAnswer>;
}
export declare function serveAttestedSession(input: { channel: FrameChannel; host: AttestedHost; now?: () => number; sessionMs?: number; timeoutMs?: number;
  log?(record: Record<string, unknown>): void }): Promise<{ outcome: 'completed' | 'refused' | 'aborted' | 'closed'; code?: string; frames?: number; error?: string }>;
export declare function createAttestedChannelPair(): [FrameChannel, FrameChannel];
