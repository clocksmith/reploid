import type { Message, ExecutionEvent, ToolAuthorization } from './index.js';
import type { Json } from '../config/index.js';
export interface LabCheckpoint { schema: 'reploid.lab-checkpoint/v1'; context: Message[]; model: Json; activities: Json[] }
import type { ResolvedConfig } from '../config/index.js';
export interface LegacyAgentLoop {
  run(goal: string | { goal?: string; text?: string; objective?: string }): Promise<unknown>;
  checkpoint(): LabCheckpoint; getExecutionEvents(): ExecutionEvent[];
  stop(): void; close(): Promise<void>; isRunning(): boolean;
  setModel(config: object): void; setModels(configs: object[]): void; setConsensusStrategy(strategy: string): void;
  hasPendingProviderResume(): boolean; getRecentActivities(): unknown[]; getProviderRetryState(): object | null;
  getProviderResumePromise(): Promise<unknown> | null; getSystemPrompt(): string; getContext(): Message[];
  injectHumanMessage(message: unknown): unknown; getMessageQueue(): unknown[];
}
declare const AgentLoop: {
  metadata: Readonly<Record<string, unknown>>;
  factory(ports: Record<string, unknown> & {
    config: ResolvedConfig; Storage: Pick<Storage, 'getItem' | 'setItem'>;
    getRuntimeMode(): string; buildInitialContext(request: Record<string, unknown>): Promise<unknown[]> | unknown[];
    Policies: Record<string, unknown>;
    authorizeTool(request: ToolAuthorization): boolean | Promise<boolean>;
    onExecutionEvent?(event: ExecutionEvent): void;
    resolveAttemptConfig?(model: object): ResolvedConfig;
  }): LegacyAgentLoop;
};
export default AgentLoop;
