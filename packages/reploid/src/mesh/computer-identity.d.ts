import type { ProviderHardware } from './provider-hardware.js';
export function participantLabel(id: string | null | undefined): string;
export interface ComputerIdentity {
  participantId: string; connectionId: string; label: string;
  labelSource: 'local-name' | 'participant-key'; persistence: 'available' | 'unavailable';
  identityBasis: 'signing-key'; hardware: ProviderHardware | null;
}
export function identifyComputer(connectionId: string, options: {
  verifyPeer(connectionId: string, signal?: AbortSignal): Promise<string | null>;
  storage?: { getItem(key: string): string | null | Promise<string | null>; setItem(key: string, value: string): unknown };
  ownerLabel?: string; hardware?: unknown; signal?: AbortSignal;
}): Promise<ComputerIdentity>;
