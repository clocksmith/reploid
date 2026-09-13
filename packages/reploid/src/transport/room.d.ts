import type { SwarmOptions, SwarmTransport } from './swarm.js';
export function createSwarmTransport(options: SwarmOptions & {
  BroadcastChannel?: typeof BroadcastChannel; createWebRTCSwarm?: () => SwarmTransport | Promise<SwarmTransport>;
}): SwarmTransport & { getTransportType(): string | null };
declare const transport: { metadata: Readonly<Record<string, unknown>>; factory: typeof createSwarmTransport };
export default transport;
