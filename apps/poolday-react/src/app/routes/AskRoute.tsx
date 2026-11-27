import { useState } from 'react';
import { createAskServices } from '../../features/ask/infrastructure/hostAsk';
import { AskPage } from '../../features/ask/presentation/AskPage';

/** /ask: "Run a model" over this page's one run controller, which lives as long as the page. */
export function AskRoute() {
  const [services] = useState(createAskServices);
  return <AskPage services={services} />;
}
