import type { ResolvedConfig } from '../config/index.js';
export interface LegacyAgentLoop {
  run(goal: string | { goal?: string; text?: string; objective?: string }): Promise<unknown>;
  stop(): void; close(): void; isRunning(): boolean;
  setModel(config: object): void; setModels(configs: object[]): void; setConsensusStrategy(strategy: string): void;
  hasPendingProviderResume(): boolean; getRecentActivities(): unknown[]; getProviderRetryState(): object | null;
  getProviderResumePromise(): Promise<unknown> | null; getSystemPrompt(): string; getContext(): unknown[];
  injectHumanMessage(message: unknown): unknown; getMessageQueue(): unknown[];
}
declare const AgentLoop: {
  metadata: Readonly<Record<string, unknown>>;
  factory(ports: Record<string, unknown> & {
    config: ResolvedConfig; Storage: Pick<Storage, 'getItem' | 'setItem'>;
    getRuntimeMode(): string; buildInitialContext(request: Record<string, unknown>): Promise<unknown[]> | unknown[];
    Policies: Record<string, unknown>;
  }): LegacyAgentLoop;
};
export default AgentLoop;
