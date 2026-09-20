export const TOOL_OFFER_MESSAGE: 'reploid:tool-offer';
export const TOOL_OFFER_ACK: 'reploid:tool-offer-ack';
export interface ToolTransferEnvelope {
  schema: 'reploid.tool-transfer/v1'; transferId: string; sender: string; recipient: string; roomId: string;
  createdAt: number; expiresAt: number; bytes: number; targetId: string; targetContract: string; text: string; offerHash: string;
}
export interface ToolTransferInbox {
  transferId: string; sender: string; recipient: string; roomId: string; envelopeHash: string; receivedAt: number;
  status: 'received' | 'refused'; reason: string; envelope: ToolTransferEnvelope | null; dismissed?: boolean;
}
export interface ToolTransferOutbox {
  envelope: ToolTransferEnvelope; envelopeHash: string; attempts: number;
  status: 'sending' | 'interrupted' | 'received' | 'refused'; error: string | null; reason?: string; acknowledgedAt?: number;
}
export interface ToolTransferState { schema: 'reploid.tool-transfers/v1'; inbox: ToolTransferInbox[]; outbox: ToolTransferOutbox[] }
export function createToolOfferChannel(options: {
  peerId: string; roomId: string;
  policy: {maxBytes: number; maxRecords: number; maxPending: number; ttlMs: number; maxAttempts: number};
  ports: {
    load(): Promise<ToolTransferState | null>; save(state: ToolTransferState): Promise<void>;
    lock<T>(operation: () => Promise<T>): Promise<T>;
    authorize(request: {action: 'offer.send' | 'offer.receive'; envelope: ToolTransferEnvelope}): Promise<boolean>;
    validateOffer(envelope: ToolTransferEnvelope): Promise<void>;
    send(peerId: string, type: string, payload: unknown): boolean | Promise<boolean>;
    now?(): number; onChange?(state: ToolTransferState): void;
  };
}): {
  list(): Promise<ToolTransferState>;
  send(input: {recipient: string; targetId: string; targetContract: string; text: string}): Promise<ToolTransferOutbox>;
  retry(transferId: string): Promise<ToolTransferOutbox>;
  receive(remote: string, type: string, payload: unknown): Promise<void>;
  dismiss(transferId: string): Promise<void>;
  /** Closes this protocol endpoint only. The host must close its borrowed transport. */
  close(): void;
};
