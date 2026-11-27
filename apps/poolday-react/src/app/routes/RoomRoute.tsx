import { useEffect, useState } from 'react';
import { createRoomServices } from '../../features/rooms/infrastructure/hostRooms';
import type { RoomServices } from '../../features/rooms/domain/rooms';
import { RoomPage } from '../../features/rooms/presentation/RoomPage';

/** /room-1: its page over this browser's records, created while mounted and disposed with it. */
export function RoomRoute() {
  const [services, setServices] = useState<RoomServices | null>(null);
  useEffect(() => {
    const opened = createRoomServices();
    setServices(opened);
    return () => opened.dispose();
  }, []);
  return services ? <RoomPage services={services} /> : null;
}
