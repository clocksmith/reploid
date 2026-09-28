import type { P2POptions } from '../../transport/assignment.js';
export function createPartitionLink(options: {
 identity: {peerId:string;privateJwk:JsonWebKey;publicJwk:JsonWebKey};roomId:string;kind:'entry'|'stage';initiator:boolean;
 config:P2POptions['config'];rtcConfig:RTCConfiguration;timeoutMs:number;
 createEndpoint(options:{channel:RTCDataChannel;localParticipantId:string;remoteParticipantId:string;kind:'entry'|'stage';initiator:boolean}):unknown;
 onChange?():void;
}):{readonly endpoint:any;readonly remoteId:string|null;getState():{state:string;kind:string;remoteId:string|null;ready:boolean;error:string|null};
 connect():Promise<void>;exportCode():Promise<string>;acceptCode(code:string):void;close():Promise<void>};
