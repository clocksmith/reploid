import type { ReactNode } from 'react';
import { Stack, Text } from '@reploid/poolday-ui';
import type { PageRoute } from '../features/shell/domain/routes';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { strings } from '../l10n/strings';
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
 * The page for one specialist route, beneath the app bar. Each feature supplies its page; a route
 * whose page has not moved yet says so.
 */
export function RoutePage({ route, product, services }: { readonly route: PageRoute; readonly product: OpenedProduct; readonly services: AppServices }) {
  const pages: Partial<Record<PageRoute, () => ReactNode>> = {
    improve: () => <ImproveRoute product={product} />,
    experiments: () => <ExperimentsRoute product={product} />,
    examples: () => <ExamplesRoute product={product} />,
    records: () => <RecordsRoute />,
    'room-1': () => <RoomRoute />,
    ask: () => <AskRoute />,
    compute: () => <ComputeRoute />,
  };
  const page = pages[route];
  return (
    <RouteFrame route={route} product={product} services={services}>
      {page ? (
        page()
      ) : (
        <Stack gap="md" data={{ 'data-route-pending': route }}>
          <Text variant="heading" as="h1">
            {strings.routes.titles[route]}
          </Text>
        </Stack>
      )}
    </RouteFrame>
  );
}
