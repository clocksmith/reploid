export type ParticipantId = `peer:${string}`;
export type Digest = `sha256:${string}`;
export type ConnectionId = string;
export type ComputerIdentityBasis = 'signing-key' | 'ledger-enrollment';

export const PARTICIPANT_ID_PATTERN: RegExp;
export const DIGEST_PATTERN: RegExp;
export const HEX_DIGEST_PATTERN: RegExp;
export const CONNECTION_ID_PATTERN: RegExp;
export const MAX_RECORD_ID_LENGTH: number;

export function isParticipantId(value: unknown): value is ParticipantId;
export function isDigest(value: unknown): value is Digest;
export function isHexDigest(value: unknown): value is string;
export function isConnectionId(value: unknown): value is ConnectionId;
export function isRecordId(value: unknown): value is string;
export function isAccountId(value: unknown): value is string;
export function isEnrollmentId(value: unknown): value is string;
export function isComputerId(value: unknown, basis?: ComputerIdentityBasis | null): value is string;
export function digestHex(value: unknown): string | null;
export function toDigest(hex: unknown): Digest | null;
