export const CYCLE_ARTIFACT_ROOT: string;
export function getCycleId(iteration: number): string;
export function getCycleArtifactPath(iteration: number, name: string): string;
export function createCycleArtifactWriter(ports?: { VFS?: { write(path: string, content: string): Promise<unknown> }; EventBus?: { emit(event: string, detail: object): void }; logger?: { warn(message: string): void } }): {
  getCycleId: typeof getCycleId; getCycleArtifactPath: typeof getCycleArtifactPath;
  writeCycleArtifact(iteration: number, name: string, payload?: Record<string, unknown>): Promise<string | null>;
  writeCycleOutcomeArtifacts(input: Record<string, unknown>): Promise<Record<string, string | null>>;
};
