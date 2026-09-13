import type { ResolvedConfig, Json } from '../config/index.js';
import type { AgentPorts, AgentSnapshot } from '../index.js';
import type { ResponseParserInstance } from './response-parser.js';
export interface AgentRuntime {
  start(): Promise<void>; stop(): void; close(): Promise<void>; isRunning(): boolean;
  getSnapshot(): AgentSnapshot; subscribe(listener: (snapshot: AgentSnapshot) => void): () => void;
  on?: AgentPorts['on']; rotateIdentity?: AgentPorts['rotateIdentity'];
  checkpoint(): Json; restore(checkpoint: Json): void;
}
export function createAgentRuntime(options: {
  config: ResolvedConfig; instanceId: string; goal: string; environment?: string;
  ports: AgentPorts; responseParser: ResponseParserInstance;
}): AgentRuntime;
