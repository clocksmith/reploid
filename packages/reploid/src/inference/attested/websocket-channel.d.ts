import type { AttestedFrame, FrameChannel } from './session.js';
export declare function encodeAttestedFrame(frame: AttestedFrame): Uint8Array;
export declare function decodeAttestedFrame(bytes: Uint8Array): AttestedFrame;
export declare function connectWebSocketFrames(url: string, options?: { signal?: AbortSignal; timeoutMs?: number; WebSocketImpl?: typeof WebSocket }): Promise<FrameChannel>;
