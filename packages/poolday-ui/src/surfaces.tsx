import type { ReactNode } from 'react';
import { cx, dataProps, type DataAttributes } from './internal.js';

/**
 * The material content sits on: `raised` is the panel material with no padding, `card` the raised
 * panel with its own padding, `well` an inset area for grouped or quoted content.
 */
export function Surface({
  variant = 'card',
  as = 'div',
  labelledBy,
  children,
  data,
}: {
  readonly variant?: 'raised' | 'card' | 'well';
  readonly as?: 'div' | 'section' | 'article' | 'aside';
  readonly labelledBy?: string;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  const Element = as;
  return (
    <Element
      className={cx(variant === 'raised' && 'pool-surface', variant === 'card' && 'pool-card', variant === 'well' && 'pool-well')}
      aria-labelledby={labelledBy}
      {...dataProps(data)}
    >
      {children}
    </Element>
  );
}

/** A padded raised panel with a title, body and optional actions. */
export function Card({
  title,
  status,
  actions,
  children,
  data,
}: {
  readonly title?: ReactNode;
  readonly status?: ReactNode;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-card pool-stack pool-gap-md" {...dataProps(data)}>
      {title !== undefined && (
        <div className="pool-row-text">
          <h3 className="pool-subheading">{title}</h3>
          {status !== undefined && <p className="pool-row-status">{status}</p>}
        </div>
      )}
      {children}
      {actions !== undefined && <div className="pool-row pool-row-end pool-gap-sm">{actions}</div>}
    </div>
  );
}
