import { useEffect, useState } from 'react';
import { createExperimentsServices } from '../../features/experiments/infrastructure/hostExperiments';
import type { ExperimentsServices } from '../../features/experiments/domain/experiments';
import { ExperimentsPage } from '../../features/experiments/presentation/ExperimentsPage';
import type { OpenedProduct } from '../../features/shell/infrastructure/productHost';

/** /experiments: its page over this page's host, created while mounted and disposed with it. */
export function ExperimentsRoute({ product }: { readonly product: OpenedProduct }) {
  const [services, setServices] = useState<ExperimentsServices | null>(null);
  useEffect(() => {
    const opened = createExperimentsServices(product);
    setServices(opened);
    return () => opened.dispose();
  }, [product]);
  return services ? <ExperimentsPage services={services} /> : null;
}
