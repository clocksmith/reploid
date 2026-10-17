export interface PluginEffect { capability: string; input: unknown; }
export interface PluginDefinition {
  manifest: { id: string; version: string; apiVersion: 1; capabilities: string[];
    limits: { maxEffects: number; maxRecordBytes: number; effectTimeoutMs: number } };
  initialize(config: any): any;
  transition(state: any, event: any): { state: any; effects: PluginEffect[] };
  project(state: any): unknown;
}
export interface PluginSession {
  view(): { sessionId: string; status: string; busy: boolean; usedEffects: number; maxEffects: number; content: any };
  export(): any;
  subscribe(listener: (view: ReturnType<PluginSession['view']>) => void): () => void;
  dispatch(event: { type: string; [key: string]: unknown }): Promise<ReturnType<PluginSession['view']>>;
  cancel(): void;
  close(): Promise<void>;
}
export function openPluginSession(options: {
  definition: PluginDefinition; config?: any; sessionId: string;
  store: { load(id: string): Promise<any>; save(id: string, record: any): Promise<void> };
  capabilities: Record<string, (input: any, context: { signal: AbortSignal; sessionId: string; effectId: number; observe(value: unknown): Promise<void> }) => Promise<any>>;
  now?: () => number;
}): Promise<PluginSession>;
