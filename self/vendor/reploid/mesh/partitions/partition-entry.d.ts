import type { PartitionActivity } from './partition-summary.js';
import type { PartitionGenerationRequest, PartitionTokenUsage } from './partition-generation-request.js';
import type { PartitionRoute, RouteAttemptBinding } from './partition-contract.js';
import type { OrderedPartitionChat } from './partition-ordered-chat.js';
import type { EntryPublicationContext, EntryPublicationOwner, EntryPublicationRecord } from './partition-entry-publication.js';
import type { OrderedPublicationContext } from './partition-ordered-publication.js';
import type { PartitionChat } from './partition-chat.js';
import type { PartitionBinding } from './partition-runner.js';
import type { PartitionChannelLimits } from '../../transport/partition-data-channel.js';
export interface PartitionInput extends PartitionBinding {
 generationRequest?:PartitionGenerationRequest;canonical?:EntryPublicationContext;meshId:string;requesterId:string;placementGeneration:number;messages:Array<{role:string;content:string}>;
}
export interface OrderedPartitionInput {
 activity?:'reploid.partition-activity/v1';
 generationRequest?:PartitionGenerationRequest;
 meshId:string;requesterId?:string;coordinatorId:string;route:PartitionRoute;modelId:string;modelIdentity:string;planId:string;
 threadId:string;attemptId:string;placementGeneration:number;disclosureExpiresAt?:number;messages:Array<{role:string;content:string}>;
 /** Requester-owned publication: text reaches the requester only through its committed records. */
 publication?:OrderedPublicationContext;
}
export interface PartitionEntry {
 readonly id:string;
 getState():{ready:boolean;descriptor:{models:any[];accepting:boolean;slots:number}|null;observedAt:number;receipt:object};
 refresh(options?:{signal?:AbortSignal}):Promise<ReturnType<PartitionEntry['getState']>>;
 generate(input:OrderedPartitionInput,options?:{signal?:AbortSignal;onActivity?:(activity:PartitionActivity)=>void|Promise<void>;onUsage?:(usage:PartitionTokenUsage)=>void|Promise<void>;onDelta?:(text:string)=>void;
  publication?:EntryPublicationOwner;onPublished?:(record:EntryPublicationRecord)=>void|Promise<void>}):Promise<{content:string;usage?:PartitionTokenUsage;execution:{identity:RouteAttemptBinding}&Record<string,unknown>}>;
 generate(input:PartitionInput,options?:{signal?:AbortSignal;onActivity?:(activity:PartitionActivity)=>void|Promise<void>;onUsage?:(usage:PartitionTokenUsage)=>void|Promise<void>;onDelta?:(text:string)=>void;publication?:EntryPublicationOwner;onPublished?:(record:EntryPublicationRecord)=>void|Promise<void>}):Promise<{content:string;usage?:PartitionTokenUsage;execution:PartitionBinding & Record<string,unknown>}>;
 drain():Promise<void>;close():Promise<void>;
}
export interface PartitionEntryOptions {channel:RTCDataChannel;localParticipantId:string;remoteParticipantId:string;service?:PartitionChat|null;canonical?:boolean;ordered?:false;
 authorize(input:PartitionInput,context:{action:string}):Promise<boolean>;limits:PartitionChannelLimits;
 inputLimits:{maxInputCharacters:number;maxOutputCharacters:number;maxAttempts:number;maxConcurrentAttempts:number;descriptorTtlMs:number};now?:()=>number}
export interface OrderedPartitionEntryOptions extends Omit<PartitionEntryOptions,'ordered'|'canonical'|'service'|'authorize'> {
 ordered:true;canonical?:false;service?:OrderedPartitionChat|null;
 authorize(input:OrderedPartitionInput,context:{action:string}):Promise<boolean>;
}
export function createPartitionEntry(options:OrderedPartitionEntryOptions):PartitionEntry;
export function createPartitionEntry(options:PartitionEntryOptions):PartitionEntry;
export function createPartitionRequester(options:{entries:()=>PartitionEntry[];requesterId:string;meshId:string;modelId:string;modelIdentity:string;planId:string;
 maxPlacements:number;ordered?:boolean;authorize(placement:object):Promise<boolean>;onAttempt?(attempt:object):void;newId?:()=>string;now?:()=>number}):{
 generate(input:{generationRequest?:PartitionGenerationRequest;messages:Array<{role:string;content:string}>;threadId:string;disclosureExpiresAt?:number},options?:{signal?:AbortSignal;onActivity?:(activity:PartitionActivity)=>void|Promise<void>;onUsage?:(usage:PartitionTokenUsage)=>void|Promise<void>;onDelta?:(delta:{text:string;threadId:string;attemptId:string;placementGeneration:number})=>void}):Promise<{content:string;usage?:PartitionTokenUsage;execution:object;recovery:object}>};
