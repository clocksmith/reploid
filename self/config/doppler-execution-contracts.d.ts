export type DopplerExecutableSchema = 'doppler.pack/v2' | 'doppler.pack/v3' | 'doppler.capsule/v2' | 'doppler.capsule/v3';
export interface DopplerExecutionContract {
  readonly schema: DopplerExecutableSchema;
  readonly releaseHistory: boolean;
  readonly openMethod: 'openPack' | 'openCapsule';
  readonly sessionSchema: string;
  readonly sessionIdentity: 'packIdentity' | 'capsuleIdentity';
  readonly receiptIdentity: 'pack' | 'capsule';
  readonly identityFields: readonly string[];
  readonly requestSchema: 'doppler.pack-operation-request/v1' | 'doppler.capsule-operation-request/v1';
  readonly eventSchema: 'doppler.pack-operation-event/v1' | 'doppler.capsule-operation-event/v1';
  readonly receiptSchema: string;
  readonly sequenceReceiptSchema: string;
  readonly adapterSchema: 'doppler.pack-adapter/v1' | 'doppler.capsule-adapter/v1';
}
export function resolveDopplerExecutionContract(schema: unknown): DopplerExecutionContract;
