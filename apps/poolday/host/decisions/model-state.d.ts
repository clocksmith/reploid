/** A model's availability as the catalog and the network report it. */
export type ModelAvailability = 'ready' | 'busy' | 'cached' | 'loading' | 'preparing' | 'unavailable';
type ModelLike = {
  readonly id?: string;
  readonly selectionId?: string;
  readonly partition?: unknown;
  readonly fleet?: unknown;
  readonly localReady?: boolean;
  readonly localCached?: boolean;
  readonly availability?: string;
  readonly networkAvailability?: string;
};

export function modelKey(model: ModelLike | null | undefined): string | undefined;
export const SERVING_STATUSES: ReadonlyArray<'ready' | 'busy'>;
export const USABLE_STATUSES: ReadonlyArray<'ready' | 'busy' | 'cached'>;
export const PREPARING_STATUSES: ReadonlyArray<'loading' | 'preparing'>;
export function servingStatus(status: string | null | undefined): boolean;
export function usableStatus(status: string | null | undefined): boolean;
export function preparingStatus(status: string | null | undefined): boolean;
export function selectableStatus(status: string | null | undefined): boolean;
export function storedHere(model: ModelLike | null | undefined): boolean;
export function servesPublicAnswers(model: ModelLike): boolean;
export function sharedModelChoice(model: ModelLike): boolean;
