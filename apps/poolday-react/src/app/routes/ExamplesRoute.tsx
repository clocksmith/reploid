import { useEffect, useState } from 'react';
import { createExamplesServices } from '../../features/examples/infrastructure/hostExamples';
import type { ExamplesServices } from '../../features/examples/domain/examples';
import { ExamplesPage } from '../../features/examples/presentation/ExamplesPage';
import type { OpenedProduct } from '../../features/shell/infrastructure/productHost';

/** /examples: its page over this page's host, created while mounted and disposed with it. */
export function ExamplesRoute({ product }: { readonly product: OpenedProduct }) {
  const [services, setServices] = useState<ExamplesServices | null>(null);
  useEffect(() => {
    const opened = createExamplesServices(product);
    setServices(opened);
    return () => opened.dispose();
  }, [product]);
  return services ? <ExamplesPage services={services} /> : null;
}
