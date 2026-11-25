import type { ReactNode } from 'react';
import { dataProps, type DataAttributes } from './internal.js';

export type Theme = 'dark' | 'light';

/**
 * The Poolday scope. Tokens (`styles/poolday/tokens.css`) attach to `.pool-home`, and every
 * primitive rule is scoped under it, so each Poolday tree starts here. A nested root re-scopes
 * the tokens to its own theme, which is how one page shows both themes side by side.
 */
export function PooldayRoot({
  theme = 'dark',
  children,
  data,
}: {
  readonly theme?: Theme;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-home" data-pool-theme={theme} {...dataProps(data)}>
      {children}
    </div>
  );
}
