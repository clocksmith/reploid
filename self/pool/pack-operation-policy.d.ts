import type { PackOperationDefinition, PackComparisonRule, PackFieldContract } from './pack-operation-adapters.js';
export function freezeOperationPolicy<T>(value: T, depth?: number): Readonly<T>;
export function resolvePackOperationDefinitions(definitions: Readonly<Record<string, PackOperationDefinition>>,
  comparisons: Readonly<Record<string, PackComparisonRule>>): Readonly<{ definitions: Readonly<Record<string, PackOperationDefinition>>;
    comparisons: Readonly<Record<string, PackComparisonRule>> }>;
export function assertOperationFields(value: unknown, contract: PackFieldContract, name: string): void;
export function assertOperationLimits(limits: Readonly<Record<string, number>>, definition: PackOperationDefinition): void;
