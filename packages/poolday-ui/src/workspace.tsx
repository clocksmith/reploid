import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { IconButton } from './buttons.js';
import { Icon, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

/**
 * The application frame: one bar of destinations, the main column and two side drawers. The bar is
 * pinned along the top on wide screens and docks at the bottom on narrow ones. The drawers lie over
 * the page's side margins and reserve no column, so the main column never moves when one opens.
 * The frame tracks the visual viewport, so a phone keyboard shrinks it without resizing the page,
 * and marks itself compact while that height is short. Where an open drawer covers the whole main
 * column (a phone), the main column is inert until it closes, so Tab and Escape stay with the drawer
 * and the bar instead of reaching controls hidden beneath it.
 */
export function Workspace({
  bar,
  start,
  end,
  children,
  startOpen = false,
  endOpen = false,
  scroll = false,
  data,
}: {
  /** A page that scrolls in its main column (the specialist routes), instead of a fixed conversation. */
  readonly scroll?: boolean;
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
  const frame = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const covered = useCoveredMain(frame, main);
  const style = { '--pool-param-workspace-height': height === null ? undefined : `${height}px` } as CSSProperties;
  return (
    <div
      ref={frame}
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
      <main ref={main} className={cx('pool-workspace-main', scroll && 'pool-workspace-scroll')} inert={covered} data-covered={covered ? '' : undefined}>
        {children}
      </main>
    </div>
  );
}

/**
 * Whether an open drawer spans the main column's whole width, measured from the layout rather than
 * restated breakpoints: after every render (a drawer opens or closes with its parent's render) and on resize.
 */
function useCoveredMain(frame: RefObject<HTMLDivElement | null>, main: RefObject<HTMLElement | null>): boolean {
  const [covered, setCovered] = useState(false);
  const measure = useRef(() => {});
  measure.current = () => {
    const root = frame.current;
    const column = main.current;
    if (!root || !column) return;
    const area = column.getBoundingClientRect();
    const next = [...root.querySelectorAll(':scope > .pool-drawer:not([hidden])')].some((drawer) => {
      const box = drawer.getBoundingClientRect();
      return box.width > 0 && box.left <= area.left + 1 && box.right >= area.right - 1;
    });
    setCovered((current) => (current === next ? current : next));
  };
  useLayoutEffect(() => measure.current());
  useEffect(() => {
    const onResize = () => measure.current();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return covered;
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
 * focus to its heading; Escape inside it closes it, and so does Escape anywhere outside a dialog while
 * it covers the main column (a phone), where it is the page's overlay.
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const section = panel.current;
    const document = section?.ownerDocument;
    if (!open || !section || !document) return undefined;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('dialog')) return;
      const inside = !!target && section.contains(target);
      const overlay = !!section.parentElement?.querySelector(':scope > .pool-workspace-main[data-covered]');
      const inOtherDrawer = !inside && !!target?.closest('.pool-drawer');
      if (inside || (overlay && !inOtherDrawer)) {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [open]);
  return (
    <section
      ref={panel}
      id={id}
      className={cx('pool-drawer', side === 'start' ? 'pool-drawer-start' : 'pool-drawer-end', 'pool-surface')}
      hidden={!open}
      aria-labelledby={titleId}
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

/** The product mark linking home, at the start of the bar. */
export function BrandLink({ href, label, data }: { readonly href: string; readonly label: string; readonly data?: DataAttributes }) {
  return (
    <a className="pool-button btn-ghost pool-plain pool-bar-button pool-bar-brand" href={href} aria-label={label} {...dataProps(data)}>
      <span className="pool-mark" aria-hidden="true">
        7<sup>7</sup>
      </span>
      <span className="pool-wordmark pool-bar-label">{label}</span>
    </a>
  );
}
