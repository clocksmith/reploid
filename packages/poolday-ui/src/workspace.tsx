import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './buttons.js';
import { Icon, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

/**
 * The application frame: one bar of destinations, the main column and two side drawers. The bar is
 * pinned along the top on wide screens and docks at the bottom on narrow ones. The drawers lie over
 * the page's side margins and reserve no column, so the main column never moves when one opens.
 * The frame tracks the visual viewport, so a phone keyboard shrinks it without resizing the page,
 * and marks itself compact while that height is short.
 */
export function Workspace({
  bar,
  start,
  end,
  children,
  startOpen = false,
  endOpen = false,
  data,
}: {
  /** Which drawers are open: where one lies over the main column, the composer gives up the strip it covers. */
  readonly startOpen?: boolean;
  readonly endOpen?: boolean;
  readonly bar: ReactNode;
  /** The start-side drawer (Threads). */
  readonly start?: ReactNode;
  /** The end-side drawer (details, Computers, Settings). */
  readonly end?: ReactNode;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  const height = useViewportHeight();
  const style = { '--pool-param-workspace-height': height === null ? undefined : `${height}px` } as CSSProperties;
  return (
    <div
      className="pool-workspace"
      data-compact={height !== null && height <= COMPACT_HEIGHT ? '' : undefined}
      data-start-open={startOpen ? '' : undefined}
      data-end-open={endOpen ? '' : undefined}
      style={style}
      {...dataProps(data)}
    >
      {bar}
      {start}
      {end}
      <main className="pool-workspace-main">{children}</main>
    </div>
  );
}

// Below this visual-viewport height (a phone with its keyboard open) the frame is compact.
const COMPACT_HEIGHT = 600;

function useViewportHeight(): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const measure = () => setHeight(Math.round(viewport?.height || window.innerHeight));
    measure();
    window.addEventListener('resize', measure);
    viewport?.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      viewport?.removeEventListener('resize', measure);
    };
  }, []);
  return height;
}

/** The bar of destinations: `lead` holds the start-side destination, `children` the rest. */
export function WorkspaceBar({ label, lead, children, data }: { readonly label: string; readonly lead?: ReactNode; readonly children: ReactNode; readonly data?: DataAttributes }) {
  return (
    <nav className="pool-workspace-bar pool-surface" aria-label={label} {...dataProps(data)}>
      <div className="pool-workspace-bar-lead">{lead}</div>
      <div className="pool-workspace-bar-end">{children}</div>
    </nav>
  );
}

/**
 * A destination in the workspace bar: an icon and its label (stacked when the bar docks at the bottom).
 * It is a link to its address, so it opens in a new tab as a link does; a plain click calls `onPress`.
 */
export function BarButton({
  icon,
  label,
  href,
  onPress,
  current = false,
  controls,
  data,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly href: string;
  readonly onPress: () => void;
  readonly current?: boolean;
  readonly controls?: string;
  readonly data?: DataAttributes;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onPress();
  };
  return (
    <a
      className="pool-button btn-ghost pool-plain pool-bar-button"
      href={href}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      aria-controls={controls}
      aria-expanded={controls ? current : undefined}
      {...dataProps(data)}
    >
      <Icon name={icon} />
      <span className="pool-bar-label">{label}</span>
    </a>
  );
}

/**
 * A side panel of the workspace: a heading with Close, then a scrolling body. Its content stays
 * mounted while it is closed, so drafts and scroll positions inside it survive. Opening it moves
 * focus to its heading; Escape inside it closes it.
 */
export function Drawer({
  id,
  side,
  title,
  open,
  onClose,
  closeLabel,
  children,
  closeData,
  data,
}: {
  /** A stable hook on the Close button, for tests and routing. */
  readonly closeData?: DataAttributes;
  readonly id?: string;
  readonly side: 'start' | 'end';
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    const document = panel.current?.ownerDocument;
    if (open && !wasOpen.current) {
      opener.current = document?.activeElement ?? null;
      heading.current?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      // Closing returns focus to what opened it (its destination in the bar) when focus was inside or lost.
      const active = document?.activeElement;
      const lost = !active || active === document?.body || panel.current?.contains(active);
      const target = opener.current;
      if (lost && target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <section
      ref={panel}
      id={id}
      className={cx('pool-drawer', side === 'start' ? 'pool-drawer-start' : 'pool-drawer-end', 'pool-surface')}
      hidden={!open}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest?.('dialog')) {
          event.preventDefault();
          onClose();
        }
      }}
      {...dataProps(data)}
    >
      <header className="pool-drawer-header">
        <h2 className="pool-heading" id={titleId} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <IconButton label={closeLabel} icon="close" onPress={onClose} data={{ 'data-drawer-close': true, ...closeData }} />
      </header>
      <div className="pool-drawer-body">{children}</div>
    </section>
  );
}
