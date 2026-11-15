import type { AuxiliaryBinding, AuxiliaryDetail, AuxiliaryPath } from '../chat/execution-policy.js';
export type RetrievalDisclosure = AuxiliaryDetail;
export type BeforeRetrievalDisclosure = (detail: RetrievalDisclosure, path?: AuxiliaryPath | null) => boolean | AuxiliaryBinding | Promise<boolean | AuxiliaryBinding>;
export declare function guardRetrievalPort<T extends {id: string; version: string}>(port: T | null, operation: RetrievalDisclosure['operation'], beforeDisclosure: BeforeRetrievalDisclosure | null | undefined, signal: AbortSignal | null): T | null;
