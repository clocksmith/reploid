import type { ResolvedConfig } from '../config/index.js';
import type { AgentPorts, AgentSnapshot, AgentCheckpointState, ExecutionEvent } from './index.js';
import type { ResponseParserInstance } from './response-parser.js';
export interface AgentRuntime {
  start(): Promise<void>; stop(): void; settle(): Promise<void>; close(): Promise<void>; isRunning(): boolean;
  getSnapshot(): AgentSnapshot; subscribe(listener: (snapshot: AgentSnapshot) => void): () => void;
  on?: AgentPorts['on']; rotateIdentity?: AgentPorts['rotateIdentity'];
  checkpoint(): AgentCheckpointState; restore(checkpoint: AgentCheckpointState): void;
  getExecutionEvents(): ExecutionEvent[];
}
export function createAgentRuntime(options: {
  config: ResolvedConfig; instanceId: string; goal: string; environment?: string;
  ports: AgentPorts; responseParser: ResponseParserInstance; onExecutionEvent?(event: ExecutionEvent): void;
}): AgentRuntime;
