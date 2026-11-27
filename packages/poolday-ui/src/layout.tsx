import type { ReactNode } from 'react';
import { cx, dataProps, gapClass, type DataAttributes, type Gap } from './internal.js';

type LayoutProps = {
  readonly gap?: Gap;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
};

/** Vertical flow with a token gap. */
export function Stack({ gap = 'md', children, data }: LayoutProps) {
  return (
    <div className={cx('pool-stack', gapClass(gap))} {...dataProps(data)}>
      {children}
    </div>
  );
}

/** Horizontal flow that wraps; `justify` aligns it. */
export function Row({
  gap = 'sm',
  justify = 'start',
  wrap = true,
  children,
  data,
}: LayoutProps & { readonly justify?: 'start' | 'between' | 'end'; readonly wrap?: boolean }) {
  return (
    <div
      className={cx('pool-row', gapClass(gap), !wrap && 'pool-row-nowrap', justify === 'between' && 'pool-row-between', justify === 'end' && 'pool-row-end')}
      {...dataProps(data)}
    >
      {children}
    </div>
  );
}

/** Equal responsive columns that fold to one on narrow screens. */
export function Columns({ gap = 'md', children, data }: LayoutProps) {
  return (
    <div className={cx('pool-columns', gapClass(gap))} {...dataProps(data)}>
      {children}
    </div>
  );
}

/** Takes the remaining space in a Row. */
export function Grow({ children }: { readonly children?: ReactNode }) {
  return <div className="pool-grow">{children}</div>;
}

/** A hairline between blocks. */
export function Divider() {
  return <hr className="pool-divider" />;
}

/**
 * A page with a sticky side navigator and a scrolling main column. On narrow screens the
 * navigator becomes a sticky bar above the content.
 */
export function SidebarLayout({
  nav,
  navLabel,
  children,
}: {
  readonly nav: ReactNode;
  readonly navLabel: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="pool-sidebar-layout">
      <nav className="pool-sidebar-nav" aria-label={navLabel}>
        {nav}
      </nav>
      <main className="pool-sidebar-main">{children}</main>
    </div>
  );
}

/** A specimen frame at a fixed reading width, so a composition can be seen as a phone shows it. */
export function Frame({
  width = 'wide',
  label,
  children,
}: {
  readonly width?: 'wide' | 'narrow';
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <figure className={cx('pool-frame', width === 'narrow' && 'pool-frame-narrow')} aria-label={label}>
      {children}
    </figure>
  );
}

/** A stream of messages that assistive technology reads as they arrive. */
export function Log({ label, children, data }: { readonly label: string; readonly children: ReactNode; readonly data?: DataAttributes }) {
  return (
    <div className="pool-stack pool-gap-lg" role="log" aria-label={label} aria-live="polite" {...dataProps(data)}>
      {children}
    </div>
  );
}
