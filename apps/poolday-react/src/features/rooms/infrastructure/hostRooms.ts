// Adapts the host's research room model (apps/poolday/host/decisions/rooms.js) to Research Room-1. The model hydrates
// the room's signed records once and follows research updates until disposed.
import * as roomsModule from '../../../../../poolday/host/decisions/rooms.js';
import type { RoomServices } from '../domain/rooms';

const { createRoomModel } = roomsModule as unknown as {
  readonly createRoomModel: (options?: RoomOptions) => RoomServices;
};

/** Options for a page staged away from the live room, as the design page stages it. */
export type RoomOptions = { readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; readonly getRoomId?: () => string; readonly hydrate?: boolean };

export function createRoomServices(options?: RoomOptions): RoomServices {
  return createRoomModel(options);
}
