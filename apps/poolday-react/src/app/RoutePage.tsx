import type { ReactNode } from 'react';
import type { PageRoute } from '../features/shell/domain/routes';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { RouteFrame } from './RouteFrame';
import { AskRoute } from './routes/AskRoute';
import { ComputeRoute } from './routes/ComputeRoute';
import { ExamplesRoute } from './routes/ExamplesRoute';
import { ExperimentsRoute } from './routes/ExperimentsRoute';
import { ImproveRoute } from './routes/ImproveRoute';
import { RecordsRoute } from './routes/RecordsRoute';
import { RoomRoute } from './routes/RoomRoute';
import type { AppServices } from './services';

/**
 * The page for one specialist route, inside the workspace frame. Every PageRoute has an explicit
 * entry so TypeScript catches any route added without a page.
 */
export function RoutePage({ route, product, services }: { readonly route: PageRoute; readonly product: OpenedProduct; readonly services: AppServices }) {
  const pages: Record<PageRoute, () => ReactNode> = {
    improve: () => <ImproveRoute product={product} />,
    experiments: () => <ExperimentsRoute product={product} />,
    examples: () => <ExamplesRoute product={product} />,
    records: () => <RecordsRoute />,
    'room-1': () => <RoomRoute />,
    ask: () => <AskRoute />,
    compute: () => <ComputeRoute />,
  };
  return (
    <RouteFrame route={route} product={product} services={services}>
      {pages[route]()}
    </RouteFrame>
  );
}
