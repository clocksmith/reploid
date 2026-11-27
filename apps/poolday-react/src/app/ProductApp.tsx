import { useEffect, useState } from 'react';
import { Button, Notice, PooldayRoot, Spinner, Stack } from '@reploid/poolday-ui';
import type { OpenedProduct } from '../features/shell/infrastructure/productHost';
import { strings } from '../l10n/strings';
import { HandedOver } from './HandedOver';
import { ProductWorkspace } from './ProductWorkspace';
import { RoutePage } from './RoutePage';
import { useAppearance, type AppServices } from './services';

type Opening = { readonly status: 'opening' } | { readonly status: 'failed'; readonly message: string } | { readonly status: 'open'; readonly product: OpenedProduct };

/**
 * Composition root of the React Poolday product: opens the host for this page (or adopts one a
 * test supplies), gives each feature its services, and closes the host when the page goes away.
 * The first visit, loading and failure states live here; the workspace takes over once open.
 */
export function ProductApp({ services }: { readonly services: AppServices }) {
  const [opening, setOpening] = useState<Opening>({ status: 'opening' });
  const [attempt, setAttempt] = useState(0);
  const [handedOver, setHandedOver] = useState(false);
  const theme = useAppearance(services.appearance);

  useEffect(() => {
    const controller = new AbortController();
    let opened: OpenedProduct | null = null;
    setOpening({ status: 'opening' });
    services.open({ signal: controller.signal }).then(
      (product) => {
        if (controller.signal.aborted) {
          // A host this mount opened is closed with it. An adopted host is the caller's and the next mount's.
          if (!services.adopted) void product.close();
          return;
        }
        opened = product;
        setOpening({ status: 'open', product });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) setOpening({ status: 'failed', message: cause instanceof Error ? cause.message : String(cause) });
      },
    );
    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) void opened?.close();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      controller.abort();
      window.removeEventListener('pagehide', onPageHide);
      if (opened) void opened.close();
    };
  }, [services, attempt]);

  // A tab that hands its history to another tab closes its session and keeps only the handover,
  // so it can ask for the history back.
  useEffect(() => {
    if (opening.status !== 'open') return undefined;
    const { product } = opening;
    return product.handover.subscribe(() => {
      if (product.handover.getState()?.state === 'moved') {
        void product.close({ keepHandover: true });
        setHandedOver(true);
      }
    });
  }, [opening]);

  return (
    <PooldayRoot theme={theme} data={{ 'data-react-shell': true }}>
      {handedOver && opening.status === 'open' ? (
        <HandedOver handover={opening.product.handover} />
      ) : opening.status === 'open' ? (
        services.route === 'workspace' ? (
          <ProductWorkspace product={opening.product} services={services} />
        ) : (
          <RoutePage route={services.route} product={opening.product} services={services} />
        )
      ) : (
        <Stack gap="lg" data={{ 'data-app-opening': opening.status }}>
          {opening.status === 'opening' && <Spinner label={strings.app.opening} />}
          <Notice
            tone="error"
            action={opening.status === 'failed' ? <Button variant="quiet" label={strings.common.retry} onPress={() => setAttempt((value) => value + 1)} /> : undefined}
          >
            {opening.status === 'failed' ? `${strings.app.failed} ${opening.message}` : null}
          </Notice>
        </Stack>
      )}
    </PooldayRoot>
  );
}
