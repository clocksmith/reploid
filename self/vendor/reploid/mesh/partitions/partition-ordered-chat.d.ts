import type { ChatModel, ChatRequest, ChatControls, ChatResult, ChatEnvelope } from '../../chat/index.js';
import type { PartitionRoute } from './partition-contract.js';
import type { OrderedExecutionRuntime, OrderedExecutionPlan, OrderedStageDevice, OrderedRouteLimits, OrderedRouteRunner } from './partition-route-execution.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
export interface OrderedChatStage extends OrderedStageDevice {
  getState(): {ready:boolean};
  subscribe(listener: (...args:any[])=>void):()=>void;
  refresh?(options?:{signal?:AbortSignal}):Promise<unknown>;
  tokenize?(request:object):Promise<{modelIdentity:string;tokenIds:number[];generation:Record<string,unknown>&{maxTokens:number}}>;
}
export interface OrderedPartitionChat {
  getModels():ChatModel[];
  getState():ReturnType<OrderedRouteRunner['getState']> & {pendingInputs:number;unsettledInputs:number};
  subscribe(listener:(models:ChatModel[])=>void):()=>void;
  refresh(options?:{signal?:AbortSignal}):Promise<ChatModel[]>;
  generate(request:ChatRequest & ChatEnvelope & {meshId:string;participantId:string;placementGeneration?:number;disclosureExpiresAt?:number},controls:ChatControls):Promise<ChatResult>;
  close():Promise<void>;
}
export interface OrderedPartitionChatOptions {
  runtime:OrderedExecutionRuntime;model:ChatModel;authority:PartitionGrantAuthority;plan:OrderedExecutionPlan;planId:string;
  limits:OrderedRouteLimits;grantTtlMs:number;ordered:{route:PartitionRoute;stages:OrderedChatStage[]};canonical?:null;
  authorizeRequester?:(request:ChatRequest & {participantId:string},signal:AbortSignal)=>Promise<boolean>;now?:()=>number;
}
export function createOrderedPartitionChat(options:OrderedPartitionChatOptions):OrderedPartitionChat;
