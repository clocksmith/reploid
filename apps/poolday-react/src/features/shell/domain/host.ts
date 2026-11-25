/**
 * The opened Poolday host, as the composition root passes it to each feature's infrastructure.
 * Its parts (chat, computers, swarm, model storage, earning…) belong to apps/poolday/host; only
 * infrastructure adapters read them, so the shell keeps the host opaque.
 */
export type HostHandle = { readonly host: object; readonly earning: Promise<unknown> };

/** Where conversation history is held, when another tab of this browser holds it. */
export type HandoverState = { readonly state: 'owner' | 'elsewhere' | 'moving' | 'moved' | 'waiting'; readonly failed: boolean };

export type HandoverPort = {
  readonly getState: () => HandoverState | null;
  readonly subscribe: (listener: () => void) => () => void;
  readonly request: () => void;
};
