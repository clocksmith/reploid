export interface AcquisitionPiece { identity: string; size: number; path: string; offset: number; }
export function createPieceAcquisition(options: {
 sources: (piece: AcquisitionPiece) => Array<{id:string;read(piece:AcquisitionPiece,options:{signal:AbortSignal}):Promise<Uint8Array>}>;
 cache:{get(identity:string):Promise<Uint8Array|null>;put(identity:string,bytes:Uint8Array):Promise<void>};
 authorize(input:{sourceId:string;piece:AcquisitionPiece}):Promise<boolean>;
 verify(piece:AcquisitionPiece,bytes:Uint8Array):Promise<boolean>;
 foregroundIdle(signal:AbortSignal):Promise<void>;
 limits:{maxConcurrent:number;maxQueued:number;maxPieceBytes:number;timeoutMs:number};
}): {acquire(piece:AcquisitionPiece,options?:{signal?:AbortSignal}):Promise<Uint8Array>;
 getReceipt():{transferredBytes:number;reusedBytes:number;completedPieces:number;failedSources:object[];active:number};close():Promise<void>};
