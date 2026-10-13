import type { PartitionRoute, RouteAttemptBinding } from './partition-contract.js';
import type { OrderedPartitionChat } from './partition-ordered-chat.js';
import type { EntryPublicationContext, EntryPublicationOwner, EntryPublicationRecord } from './partition-entry-publication.js';
import type { PartitionChat } from './partition-chat.js';
import type { PartitionBinding } from './partition-runner.js';
import type { PartitionChannelLimits } from '../../transport/partition-data-channel.js';
export interface PartitionInput extends PartitionBinding {
 canonical?:EntryPublicationContext;meshId:string;requesterId:string;placementGeneration:number;messages:Array<{role:string;content:string}>;
}
export interface OrderedPartitionInput {
 meshId:string;requesterId?:string;coordinatorId:string;route:PartitionRoute;modelId:string;modelIdentity:string;planId:string;
 threadId:string;attemptId:string;placementGeneration:number;messages:Array<{role:string;content:string}>;
}
export interface PartitionEntry {
 readonly id:string;
 getState():{ready:boolean;descriptor:{models:any[];accepting:boolean;slots:number}|null;observedAt:number;receipt:object};
 refresh(options?:{signal?:AbortSignal}):Promise<ReturnType<PartitionEntry['getState']>>;
 generate(input:OrderedPartitionInput,options?:{signal?:AbortSignal;onDelta?:(text:string)=>void}):Promise<{content:string;execution:{identity:RouteAttemptBinding}&Record<string,unknown>}>;
 generate(input:PartitionInput,options?:{signal?:AbortSignal;onDelta?:(text:string)=>void;publication?:EntryPublicationOwner;onPublished?:(record:EntryPublicationRecord)=>void|Promise<void>}):Promise<{content:string;execution:PartitionBinding & Record<string,unknown>}>;
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
 generate(input:{messages:Array<{role:string;content:string}>;threadId:string},options?:{signal?:AbortSignal;onDelta?:(delta:{text:string;threadId:string;attemptId:string;placementGeneration:number})=>void}):Promise<{content:string;execution:object;recovery:object}>};
