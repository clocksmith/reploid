/** Host contribution progress while Doppler prepares a resident's GPU pipelines. */
export interface ResidentPreparationProgress {
  stage: 'preparing';
  status: 'preparing' | 'prepared' | 'cancelling' | 'cancelled' | 'timed-out' | 'failed';
  prepared: number;
  total: number;
  key: string | null;
  elapsedMs: number;
  startedAt: number | null;
  maxDurationMs: number | null;
  /** A started compilation still owns the stage; nothing it holds has been released. */
  outstanding: boolean;
  message: string;
}
/** Map a Doppler `onLoadProgress` event; returns null for any event that is not pipeline preparation. */
export function residentPreparationProgress(event: unknown): ResidentPreparationProgress | null;
