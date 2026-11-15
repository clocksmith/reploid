export interface RetrievalDisclosure { operation: 'search' | 'extract' | 'check'; id: string; version: string }
export type BeforeRetrievalDisclosure = (detail: RetrievalDisclosure) => boolean | Promise<boolean>;
export declare function guardRetrievalPort<T extends {id: string; version: string}>(port: T | null, operation: RetrievalDisclosure['operation'], beforeDisclosure: BeforeRetrievalDisclosure | null | undefined, signal: AbortSignal | null): T | null;
