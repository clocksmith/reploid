import type { RouteAttemptBinding } from './partition-contract.js';
export interface PartitionActivity { schema:'reploid.partition-activity/v1'; identity:RouteAttemptBinding; sequence:number; stepSummary:{count:number;stages:Array<{partitionIndex:number;steps:number;stepMs:{count:number;total:number}}>}; }
export function partitionActivity(value:unknown,identity:RouteAttemptBinding,previous?:PartitionActivity|null,coalesced?:boolean):PartitionActivity;
export function summarizePartitionExecution(execution: Record<string, any>): Record<string, any>;
