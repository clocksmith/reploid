export interface ModelAdapterSelection { identity: string; baseModelIdentity: string }
export interface AdapterArtifact { url: string; sizeBytes: number; hash: string }
export interface CatalogModelAdapter extends ModelAdapterSelection {
  artifact: AdapterArtifact; manifest: { weightsPath: string; baseModel: string; [key: string]: unknown };
  weightsLayout?: string;
}
export interface AdapterCatalogModel {
  identity?: string; adapters?: ModelAdapterSelection[]; availableAdapters?: CatalogModelAdapter[];
}
export function selectModelAdapters(model: AdapterCatalogModel, selections?: ModelAdapterSelection[]): CatalogModelAdapter[];
export interface AcquiredModelAdapter {
  manifest: CatalogModelAdapter['manifest'];
  options: { weightsLayout?: string; readOPFS: undefined; writeOPFS: undefined; fetchUrl(url: string): Promise<ArrayBufferLike> };
}
export function createModelAdapterResolver(options: { models: AdapterCatalogModel[];
  acquire?: (artifact: AdapterArtifact, options: { signal: AbortSignal }) => Promise<ArrayBufferLike | Uint8Array>;
  fetchImpl?: typeof fetch;
}): (selection: ModelAdapterSelection, options: { signal: AbortSignal }) => Promise<AcquiredModelAdapter>;
export function fetchAdapterFile(artifact: AdapterArtifact, options: { signal: AbortSignal; fetchImpl?: typeof fetch }): Promise<Uint8Array>;
