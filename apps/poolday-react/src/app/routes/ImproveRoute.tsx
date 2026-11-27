import { useEffect, useState } from 'react';
import { createImproveServices } from '../../features/improve/infrastructure/hostImprove';
import type { ImproveServices } from '../../features/improve/domain/improve';
import { ImprovePage } from '../../features/improve/presentation/ImprovePage';
import type { OpenedProduct } from '../../features/shell/infrastructure/productHost';

/** /improve: its page over this page's host, created while mounted and disposed with it. */
export function ImproveRoute({ product }: { readonly product: OpenedProduct }) {
  const [services, setServices] = useState<ImproveServices | null>(null);
  useEffect(() => {
    const opened = createImproveServices(product);
    setServices(opened);
    return () => opened.dispose();
  }, [product]);
  return services ? <ImprovePage services={services} /> : null;
}
