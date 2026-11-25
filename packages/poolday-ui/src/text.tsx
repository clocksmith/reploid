import type { ReactNode } from 'react';
import { cx, dataProps, type DataAttributes } from './internal.js';

export type TextVariant = 'title' | 'heading' | 'subheading' | 'body' | 'small' | 'caption' | 'label';
export type TextElement = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'strong' | 'code';

const VARIANT_CLASS: Record<TextVariant, string> = {
  title: 'pool-title',
  heading: 'pool-heading',
  subheading: 'pool-subheading',
  body: 'pool-body',
  small: 'pool-small',
  caption: 'pool-caption',
  label: 'pool-label',
};

/** One step of the Poolday type scale. Pick the variant for the role, never for a size. */
export function Text({
  variant = 'body',
  as = 'p',
  muted = false,
  mono = false,
  id,
  children,
  data,
}: {
  readonly variant?: TextVariant;
  readonly as?: TextElement;
  readonly muted?: boolean;
  readonly mono?: boolean;
  readonly id?: string;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  const Element = as;
  return (
    <Element
      id={id}
      // Mono text is identifiers and values, which have no spaces to wrap at.
      className={cx(VARIANT_CLASS[variant], muted && 'pool-muted', mono && 'pool-mono', mono && 'pool-break')}
      {...dataProps(data)}
    >
      {children}
    </Element>
  );
}

/** The REPLOID wordmark beside the 7 to the 7 mark. */
export function Wordmark({ label = 'REPLOID' }: { readonly label?: string }) {
  return (
    <span className="pool-row pool-gap-sm">
      <span className="pool-mark" aria-hidden="true">
        7<sup>7</sup>
      </span>
      <span className="pool-wordmark">{label}</span>
    </span>
  );
}

/** Text for assistive technology only; it takes no space. */
export function VisuallyHidden({ children, id }: { readonly children: ReactNode; readonly id?: string }) {
  return (
    <span className="pool-visually-hidden" id={id}>
      {children}
    </span>
  );
}

/** A term and its value pairs, muted terms over values. */
export function Facts({ items }: { readonly items: ReadonlyArray<readonly [term: string, value: ReactNode]> }) {
  return (
    <dl className="pool-facts pool-stack pool-gap-xs pool-small">
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
