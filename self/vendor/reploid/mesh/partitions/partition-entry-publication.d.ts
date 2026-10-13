import type { PartitionInput } from './partition-entry.js';
import type { PublicationReceipt } from '../../chat/workspace-publication.js';
export interface EntryPublicationContext {
 schema:'reploid.partition-publication-context/v1';publisherEpoch:string;coordinatorEpoch:string;routeId:string;
 generation:{generationId:string;executionIdentity:string;policy:Record<string,unknown>};vocabSize:number;deadlineAt:number;
 stages:readonly {stageId:string;participantId:string;participantEpoch:string;deviceEpoch:string;residentId:string;partitionIndex:number;executionId:string}[];
}
export interface EntryPublicationRecord {
 publication:Record<string,unknown>;receipt:PublicationReceipt;evidence:readonly unknown[];
}
export interface EntryPublicationOwner {
 readonly requiresCommitEvidence:true | boolean;
 reconcile():Promise<{head:string|null;attempts:Array<{identity:{attemptId:string;coordinatorEpoch:string}}>} >;
 admitAttempt(input:Record<string,unknown>):Promise<unknown>;
 publish(input:Record<string,unknown>,options:{evidence:readonly unknown[]}):Promise<PublicationReceipt>;
 cancel(attemptId:string,coordinatorEpoch:string):Promise<unknown>;
}
export const ENTRY_PUBLICATION_SCHEMA:'reploid.partition-publication/v1';
export function validateEntryPublicationContext(value:unknown,request:PartitionInput):EntryPublicationContext;
export function entryPublicationEnvelope(request:PartitionInput,method:'head'|'admit'|'publish'|'cancel',body:unknown):Record<string,unknown>;
export function matchingEntryPublication(message:Record<string,unknown>,request:PartitionInput):boolean;
export function createEntryPublicationScope(options:{request:PartitionInput;owner:EntryPublicationOwner;
 authorize(method:string):boolean|Promise<boolean>;onPublished(record:EntryPublicationRecord):void|Promise<void>;
 maxControlBytes:number;maxOutputCharacters:number}):{
 call(method:'head'|'admit'|'publish'|'cancel',body:unknown):Promise<unknown>;
 close(options?:{cancel?:boolean}):Promise<void>;getProjection():{content:string;count:number;terminal:boolean};
};
