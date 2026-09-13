import type { Authorize, Control } from '../index.js';
export interface ToolRunner {
  executeTool(name: string, args?: Record<string, unknown>, context?: Control): Promise<unknown>;
  loadModule(args: string | { path: string; force?: boolean }): Promise<Record<string, unknown>>;
  listToolNames(): string[]; close(): void;
}
export function createToolRunner(options: {
  Utils?: unknown; logger?: unknown; VFS?: unknown;
  readFile?: (args: unknown) => Promise<unknown>; writeFile?: (args: unknown) => Promise<unknown>;
  builtInTools?: Record<string, (args: Record<string, unknown>, control?: Control) => unknown>;
  authorize: Authorize; isLoadablePath?: (path: string) => boolean;
  loadModule?: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): ToolRunner;
declare const api: { createToolRunner: typeof createToolRunner };
export default api;
