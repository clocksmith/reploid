import { useEffect, useState } from 'react';
import { createRecordsServices } from '../../features/records/infrastructure/hostRecords';
import type { RecordsServices } from '../../features/records/domain/records';
import { RecordsPage } from '../../features/records/presentation/RecordsPage';

/** /records, also /history: its page over this browser's records, created while mounted and disposed with it. */
export function RecordsRoute() {
  const [services, setServices] = useState<RecordsServices | null>(null);
  useEffect(() => {
    const opened = createRecordsServices();
    setServices(opened);
    return () => opened.dispose();
  }, []);
  return services ? <RecordsPage services={services} /> : null;
}
