import type { Json } from '../config/index.js';
export interface Store {
  get(key: string): Promise<Json>; set(key: string, value: Json): Promise<void>;
  delete(key: string): Promise<boolean>; keys(prefix?: string): Promise<string[]>; close(): Promise<void>;
}
export interface Vfs {
  init(): Promise<boolean>; read(path: string): Promise<string>; write(path: string, content: string): Promise<boolean>;
  delete(path: string): Promise<boolean>; list(path?: string): Promise<string[]>;
  stat(path: string): Promise<{ path: string; size: number; updated: number; type: string } | null>;
  exists(path: string): Promise<boolean>; isEmpty(): Promise<boolean>; mkdir(path: string): Promise<boolean>;
  clear(): Promise<boolean>; exportAll(): Promise<object>; importAll(data: object, clearFirst?: boolean): Promise<number>;
}
export function createMemoryStore(): Store;
export function createVfs(ports: { store: Store; now?: () => number; emit?: (name: string, event: object) => void }): Vfs;
