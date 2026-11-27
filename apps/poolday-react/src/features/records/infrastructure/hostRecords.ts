// Adapts the host's records model (apps/poolday/host/decisions/records.js) to the Records page. The model polls
// shared-room activity and follows this profile's ledgers until disposed.
import * as recordsModule from '../../../../../poolday/host/decisions/records.js';
import type { RecordsServices } from '../domain/records';

const { createRecordsModel } = recordsModule as unknown as {
  readonly createRecordsModel: (options?: RecordsOptions) => RecordsServices;
};

/** Options for a page staged away from the live room, as the design page stages it. */
export type RecordsOptions = { readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; readonly getRoomId?: () => string; readonly poll?: boolean };

export function createRecordsServices(options?: RecordsOptions): RecordsServices {
  return createRecordsModel(options);
}
