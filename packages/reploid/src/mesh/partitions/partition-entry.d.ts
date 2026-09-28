import type { PartitionChat } from './partition-chat.js';
import type { PartitionBinding } from './partition-runner.js';
import type { PartitionChannelLimits } from '../../transport/partition-data-channel.js';
export interface PartitionInput extends PartitionBinding {
 meshId:string;requesterId:string;placementGeneration:number;messages:Array<{role:string;content:string}>;
}
export interface PartitionEntry {
 readonly id:string;
 getState():{ready:boolean;descriptor:{models:any[];accepting:boolean;slots:number}|null;observedAt:number;receipt:object};
 refresh(options?:{signal?:AbortSignal}):Promise<ReturnType<PartitionEntry['getState']>>;
 generate(input:PartitionInput,options?:{signal?:AbortSignal}):Promise<{content:string;execution:PartitionBinding & Record<string,unknown>}>;
 drain():Promise<void>;close():Promise<void>;
}
export function createPartitionEntry(options:{channel:RTCDataChannel;localParticipantId:string;remoteParticipantId:string;service?:PartitionChat|null;
 authorize(input:PartitionInput,context:{action:string}):Promise<boolean>;limits:PartitionChannelLimits;
 inputLimits:{maxInputCharacters:number;maxOutputCharacters:number;maxAttempts:number;maxConcurrentAttempts:number;descriptorTtlMs:number};now?:()=>number}):PartitionEntry;
export function createPartitionRequester(options:{entries:()=>PartitionEntry[];requesterId:string;meshId:string;modelId:string;modelIdentity:string;planId:string;
 maxPlacements:number;authorize(placement:object):Promise<boolean>;onAttempt?(attempt:object):void;newId?:()=>string;now?:()=>number}):{
 generate(input:{messages:Array<{role:string;content:string}>;threadId:string},options?:{signal?:AbortSignal}):Promise<{content:string;execution:object;recovery:object}>};
