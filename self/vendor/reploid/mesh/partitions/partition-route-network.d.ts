export declare const ORDERED_PARTITION_CHANNEL: 'reploid-partitions-ordered';
import type { PartitionRoute } from './partition-contract.js';
import type { SwarmTransport } from '../../transport/swarm.js';
export interface RoutePartitionNetwork<T> {
  connect(peerId:string, options:{route:PartitionRoute}):Promise<T>;
  retire(peerId:string, options:{route:PartitionRoute}):Promise<void>;
  getState():{closed:boolean;channels:number;retiring:number};
  close():Promise<void>;
}
export interface RoutePartitionNetworkOptions<T> {
  transport:SwarmTransport;
  verifyPeer(peerId:string,signal:AbortSignal):Promise<string|null>;
  createEndpoint(options:{channel:RTCDataChannel;remoteParticipantId:string;remoteTransportId:string;route:PartitionRoute}):T;
  maxPeers:number;timeoutMs:number;label:'reploid-partitions-ordered';
  ordered:{maxRouteBytes:number;validateRoute(route:PartitionRoute,context:{remoteParticipantId:string;remoteTransportId:string;incoming:boolean;signal:AbortSignal}):Promise<boolean>};
  onPeer?(peerId:string,endpoint:T,route:PartitionRoute):void;
}
export function createRoutePartitionNetwork<T extends {close():void|Promise<void>}>(options:RoutePartitionNetworkOptions<T>):RoutePartitionNetwork<T>;
