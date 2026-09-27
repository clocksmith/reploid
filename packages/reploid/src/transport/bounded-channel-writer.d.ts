import type { PartitionChannelLimits } from './partition-data-channel.js';
export function createBoundedChannelWriter(options: {
  channel: RTCDataChannel; limits: PartitionChannelLimits; signal: AbortSignal;
  account(size: number): void;
}): (data: string | ArrayBuffer, signal?: AbortSignal) => Promise<void>;
