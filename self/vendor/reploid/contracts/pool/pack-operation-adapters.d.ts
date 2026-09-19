export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface PackFieldContract {
  readonly version: number;
  readonly allowedFields: readonly string[];
  readonly requiredFields: readonly string[];
  readonly fieldTypes: Readonly<Record<string, 'positive-integer' | 'finite-number' | 'boolean'>>;
}
export interface PackOperationDefinition {
  readonly schema: 'reploid.pool.operation-definition/v1';
  readonly version: number;
  readonly adapterId: string;
  readonly dopplerOperation: { readonly name: string; readonly version: number };
  readonly workload: string;
  readonly inputContract: PackFieldContract;
  readonly optionsContract: PackFieldContract;
  readonly outputContract: { readonly version: number };
  readonly streaming: { readonly partial: boolean };
  readonly maximumLimits: Readonly<Record<'maxInputBytes' | 'maxOutputBytes' | 'maxStreamBytes' | 'maxEvents' | 'maxJobMs', number>>;
  readonly comparisonPolicyIds: readonly string[];
  readonly inputClasses: { readonly local: readonly string[]; readonly remote: readonly string[]; readonly defaultRemote: string | null };
}
export interface PackComparisonRule {
  readonly requiredFields: readonly string[];
  readonly nonnegativeFields: readonly string[];
}
export interface PackOperationImplementation {
  readonly contractVersion: number;
  validateRequest(request: import('./pack-operation.js').PackOperationRequest, definition: PackOperationDefinition): void;
  validateOutput(output: JsonValue, request: import('./pack-operation.js').PackOperationRequest,
    context: { readonly completed: boolean }, definition: PackOperationDefinition): void;
  compare(output: JsonValue, reference: JsonValue, policy: Readonly<Record<string, JsonValue>>, definition: PackOperationDefinition): boolean;
}
export interface PackOperationAdapter {
  readonly definition: PackOperationDefinition;
  readonly policy: { readonly definition: PackOperationDefinition; readonly comparisons: Readonly<Record<string, PackComparisonRule>> };
  readonly implementation: PackOperationImplementation;
  readonly version: number;
  readonly workload: string;
  validateRequest(request: Pick<import('./pack-operation.js').PackOperationRequest, 'input' | 'options'>): void;
  validateOutput(output: JsonValue, request: import('./pack-operation.js').PackOperationRequest, context: { readonly completed: boolean }): void;
  compare(output: JsonValue, reference: JsonValue, policy: Readonly<Record<string, JsonValue>>): boolean;
}
export type PackOperationRegistry = Readonly<Record<string, PackOperationAdapter>>;
export const PACK_OPERATION_IMPLEMENTATIONS: Readonly<Record<string, PackOperationImplementation>>;
export function createPackOperationRegistry(options?: {
  definitions?: Readonly<Record<string, PackOperationDefinition>>;
  comparisons?: Readonly<Record<string, PackComparisonRule>>;
  implementations?: Readonly<Record<string, PackOperationImplementation>>;
}): PackOperationRegistry;
