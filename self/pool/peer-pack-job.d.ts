import type { JsonValue, PackOperationAdapter, PackOperationRegistry } from './pack-operation-adapters.js';
import type { PackOperationRequest } from './pack-operation.js';
import type { PackJobPolicy, CurrentPackJobPolicy } from './peer-pack-job-policy.js';
import type { ProviderCapabilities, WorkRequirements } from './peer-capabilities.js';
import type { OperationAssignmentPlan } from './peer-planning.js';
type JsonObject = Readonly<Record<string, JsonValue>>;
export interface PackPeerIdentity {
  readonly keyId: string;
  readonly publicKey: string;
  readonly privateKey: CryptoKey;
}
export interface SignedPackPeerMessage<Body = JsonObject> {
  readonly peerControlVersion: 'reploid_peer_control/v1';
  readonly network: 'poolday';
  readonly type: string;
  readonly fromPeerId: string;
  readonly toPeerId: string | null;
  readonly publicKey: string;
  readonly body: Body;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
  readonly causalRefs: readonly JsonValue[];
  readonly messageHash: string;
  readonly signature: string;
}
export type PackPeerLimits = Readonly<Record<'maxInputBytes' | 'maxOutputBytes' | 'maxStreamBytes' | 'maxEvents' | 'maxJobMs', number>>;
export type PackPeerModel = JsonObject & {
  readonly modelId: string;
  readonly modelHash: string;
  readonly manifestHash: string;
  readonly runtimeVersion: string;
  readonly executablePack: JsonObject & { readonly requiredOperation: string };
};
export interface PackProviderAdvertBody {
  readonly schema: 'reploid.peer.pack_provider/v2';
  readonly models: readonly PackPeerModel[];
  readonly limits: PackPeerLimits;
  readonly capabilities: ProviderCapabilities;
}
export interface PackPeerConsent {
  readonly schema: 'reploid.peer.public_operation_consent/v1';
  readonly publicInput: true;
  readonly providerIds: readonly string[];
}
export interface PackPeerJobIntent {
  readonly model: PackPeerModel;
  readonly limits: PackPeerLimits & { readonly deadlineAt: number };
  readonly consent: PackPeerConsent;
  readonly comparisonPolicy: JsonObject;
  readonly jobId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly adapterSet: readonly JsonValue[];
  readonly inputClass: string;
  readonly operationPolicy: PackOperationAdapter['policy'];
  readonly jobPolicy: PackJobPolicy;
  readonly operationPolicyDigest: string;
  readonly jobPolicyDigest: string;
  readonly selectedAt: number;
  readonly inputHash: string;
  readonly resources: WorkRequirements['resources'];
  readonly planning: { readonly adverts: readonly SignedPackPeerMessage<PackProviderAdvertBody>[]; readonly plan: OperationAssignmentPlan };
}
export interface PackPeerJobBody {
  readonly schema: 'reploid.peer.pack_job/v3';
  readonly advert: SignedPackPeerMessage<PackProviderAdvertBody>;
  readonly intent: PackPeerJobIntent;
  readonly assignment: JsonObject;
  readonly request: PackOperationRequest;
}
export const PACK_JOB_SCHEMA: string;
export const PACK_UPDATE_SCHEMA: string;
export const PACK_CANCEL_SCHEMA: string;
export const PACK_JOB_MAX_WIRE_BYTES: number;
export function requirePackJob(ok: unknown, message: string): asserts ok;
export function packJobBytes(value: unknown): number;
export function packPeerModel(model: JsonObject, registry?: PackOperationRegistry): PackPeerModel;
export function validatePackPeerLimits(limits: PackPeerLimits, policy?: PackJobPolicy): void;
export function signPackPeerMessage<Body>(options: { identity: PackPeerIdentity; type: string; recipient?: string | null;
  body: Body; expiresAt: number; policy?: PackJobPolicy }): Promise<SignedPackPeerMessage<Body>>;
export function verifyPackPeerMessage<Body>(message: SignedPackPeerMessage<Body>, options: { type: string; recipient?: string | null;
  sender?: string | null; now?: number; policy?: PackJobPolicy }): Promise<SignedPackPeerMessage<Body>>;
export function createPackProviderAdvert(options: { identity: PackPeerIdentity; models: readonly JsonObject[];
  capabilities: ProviderCapabilities; limits: PackPeerLimits; expiresAt: number; registry?: PackOperationRegistry; policy?: CurrentPackJobPolicy }): Promise<SignedPackPeerMessage<PackProviderAdvertBody>>;
export function planPackPeerProviders(options: { adverts: readonly SignedPackPeerMessage<PackProviderAdvertBody>[];
  requirements: WorkRequirements; now: number; registry?: PackOperationRegistry; policy?: CurrentPackJobPolicy }): Promise<OperationAssignmentPlan>;
export function createPackPeerJob(options: { identity: PackPeerIdentity; advert?: SignedPackPeerMessage<PackProviderAdvertBody>;
  adverts?: readonly SignedPackPeerMessage<PackProviderAdvertBody>[]; resources: WorkRequirements['resources'];
  model: JsonObject; input: JsonObject; options?: JsonObject; limits: PackPeerJobIntent['limits']; consent: PackPeerConsent;
  comparisonPolicy: JsonObject; jobId?: string; attemptId?: string; attemptNumber?: number; adapterSet?: readonly JsonValue[];
  registry?: PackOperationRegistry; policy?: CurrentPackJobPolicy }): Promise<SignedPackPeerMessage<PackPeerJobBody>>;
export function verifyPackPeerJob(message: SignedPackPeerMessage<PackPeerJobBody>, options: { providerId: string;
  models: readonly JsonObject[]; registry?: PackOperationRegistry; now?: number; allowLegacy?: false; policy?: PackJobPolicy }): Promise<SignedPackPeerMessage<PackPeerJobBody>>;
/** Legacy archives require their own schema narrowing and cannot enter live admission. */
export function verifyPackPeerJob<Body>(message: SignedPackPeerMessage<Body>, options: { providerId: string;
  models: readonly JsonObject[]; registry?: PackOperationRegistry; now?: number; allowLegacy: true; policy?: PackJobPolicy }): Promise<SignedPackPeerMessage<Body>>;
