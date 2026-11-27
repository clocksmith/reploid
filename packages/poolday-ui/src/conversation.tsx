import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Icon, IconGlyph, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

/**
 * The scrolling transcript. It keeps a reader at the bottom while new output arrives, leaves one
 * who scrolled up (or is selecting text) where they are, and remembers each conversation's
 * position, so returning to a conversation returns to where it was read.
 */
export function Transcript({
  label,
  conversation,
  children,
  footer,
  logData,
  onWatchedVisible,
  data,
}: {
  /**
   * Told whether any element marked `data-transcript-watch` (an answer's live Stop) is wholly in view, so a
   * second control for the same action can step aside while it is.
   */
  readonly onWatchedVisible?: (visible: boolean) => void;
  readonly label: string;
  /** The conversation shown; its scroll position is kept when it changes. */
  readonly conversation: string | null;
  readonly children: ReactNode;
  /**
   * Shown at the end of the scrolling frame, outside the message log (it is not announced as output): suggestions for
   * an empty conversation. It scrolls with the messages, so the composer below never covers it.
   */
  readonly footer?: ReactNode;
  /** Stable hooks on the message log itself (the scrolling frame takes `data`). */
  readonly logData?: DataAttributes;
  readonly data?: DataAttributes;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string | null, number>());
  const shown = useRef<string | null | undefined>(undefined);
  const nearBottom = useRef(true);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (shown.current !== conversation) {
      if (shown.current !== undefined) positions.current.set(shown.current, lastTop.current);
      shown.current = conversation;
      node.scrollTop = positions.current.get(conversation) ?? node.scrollHeight;
      nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM;
    }
  }, [conversation]);

  const lastTop = useRef(0);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return undefined;
    const onScroll = () => {
      lastTop.current = node.scrollTop;
      nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM;
    };
    // New output keeps a reader at the bottom there, unless they are selecting text.
    const follow = () => {
      const selection = node.ownerDocument.getSelection?.();
      const selecting = selection && !selection.isCollapsed && node.contains(selection.anchorNode);
      if (nearBottom.current && !selecting) node.scrollTop = node.scrollHeight;
    };
    const content = node.firstElementChild;
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
    if (content) resize?.observe(content);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      resize?.disconnect();
      node.removeEventListener('scroll', onScroll);
    };
  }, []);

  const report = useRef(onWatchedVisible);
  report.current = onWatchedVisible;
  const watcher = useRef<IntersectionObserver | null>(null);
  const watched = useRef(new Map<Element, boolean>());
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof IntersectionObserver !== 'function') return undefined;
    const states = watched.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (states.has(entry.target)) states.set(entry.target, entry.isIntersecting && entry.intersectionRatio >= 1);
        report.current?.([...states.values()].some(Boolean));
      },
      { root: node, threshold: 1 },
    );
    watcher.current = observer;
    return () => {
      observer.disconnect();
      states.clear();
      watcher.current = null;
    };
  }, []);
  // After each render, watch what is newly marked and forget what left.
  useEffect(() => {
    const observer = watcher.current, node = scroller.current;
    if (!observer || !node) return;
    const states = watched.current;
    const current = new Set(node.querySelectorAll('[data-transcript-watch]'));
    let changed = false;
    for (const element of [...states.keys()]) {
      if (!current.has(element)) {
        observer.unobserve(element);
        states.delete(element);
        changed = true;
      }
    }
    for (const element of current) {
      if (!states.has(element)) {
        states.set(element, false);
        observer.observe(element);
      }
    }
    if (changed) report.current?.([...states.values()].some(Boolean));
  });

  return (
    <div className="pool-transcript" ref={scroller} {...dataProps(data)}>
      <div className="pool-transcript-log" role="log" aria-label={label} aria-live="polite" {...dataProps(logData)}>
        {children}
      </div>
      {footer ? <div className="pool-transcript-footer">{footer}</div> : null}
    </div>
  );
}
// Within this distance of the end, a reader is following the answer.
const NEAR_BOTTOM = 80;

/**
 * The conversation column: the transcript fills the height and scrolls, notices sit under it, and
 * the composer stays at the bottom. Everything shares one reading width, centred in the main column.
 */
export function ConversationLayout({
  transcript,
  notices,
  composer,
  composerData,
  data,
}: {
  readonly transcript: ReactNode;
  readonly notices?: ReactNode;
  readonly composer: ReactNode;
  /** Stable hooks on the composer's region, whose box stays put while drawers open. */
  readonly composerData?: DataAttributes;
  readonly data?: DataAttributes;
}) {
  return (
    <section className="pool-conversation" {...dataProps(data)}>
      {transcript}
      {notices ? <div className="pool-conversation-notices pool-stack pool-gap-sm">{notices}</div> : null}
      <footer className="pool-conversation-composer" {...dataProps(composerData)}>
        {composer}
      </footer>
    </section>
  );
}

/**
 * One message: the person's on an inset bubble at the end of the column, an answer across the
 * column as reading text. `footer` holds its activity, measurements and actions.
 */
export function MessageRow({
  role,
  author,
  children,
  footer,
  data,
}: {
  readonly role: 'user' | 'assistant';
  /** A short line above an answer that has no text yet ("Thinking…"); omit otherwise. */
  readonly author?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <article className={cx('pool-message', role === 'user' ? 'pool-message-user pool-reveal-host' : 'pool-message-assistant')} {...dataProps(data)}>
      {author ? <span className="pool-small pool-muted">{author}</span> : null}
      {children}
      {footer ? <div className="pool-message-footer pool-row pool-gap-sm pool-small pool-muted">{footer}</div> : null}
    </article>
  );
}

/** The person's words on the inset bubble, kept as typed. */
export function MessageText({ label, children, data }: { readonly label: string; readonly children: ReactNode; readonly data?: DataAttributes }) {
  return (
    <div className="pool-message-text pool-well pool-body" aria-label={label} {...dataProps(data)}>
      {children}
    </div>
  );
}

/** Availability as a small dot beside a name: ready (filled), waiting (pulsing) or unavailable (hollow). */
export function StatusDot({ state, data }: { readonly state: 'ready' | 'waiting' | 'unavailable'; readonly data?: DataAttributes }) {
  return (
    <span
      className={cx('pool-dot', state === 'unavailable' && 'pool-dot-open', state === 'waiting' && 'pool-dot-pulse')}
      data-availability={state}
      aria-hidden="true"
      {...dataProps(data)}
    />
  );
}

/**
 * The control that opens a picker and names what is chosen: a status dot, then its parts joined
 * by a separator, then a chevron. Each part keeps one line and truncates, the last first.
 */
export function SelectorButton({
  label,
  status,
  parts,
  placeholder,
  onPress,
  disabled = false,
  describedBy,
  activity = 'idle',
  focusSignal,
  data,
}: {
  /** Focuses the control each time this number changes (after its picker closes). */
  readonly focusSignal?: number;
  /** The accessible name: what is chosen and its availability. */
  readonly label: string;
  readonly status?: 'ready' | 'waiting' | 'unavailable';
  readonly parts: ReadonlyArray<{ readonly text: string; readonly data?: DataAttributes }>;
  /** Shown instead of the parts while nothing is chosen. */
  readonly placeholder?: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly describedBy?: string;
  readonly activity?: 'idle' | 'ready';
  readonly data?: DataAttributes;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusSignal) button.current?.focus({ preventScroll: true });
  }, [focusSignal]);
  return (
    <button
      ref={button}
      type="button"
      className="pool-button btn-ghost pool-selector"
      aria-label={label}
      aria-haspopup="dialog"
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onPress}
      data-activity={activity}
      {...dataProps(data)}
    >
      {placeholder !== undefined && <span className="pool-small">{placeholder}</span>}
      <span className="pool-selector-parts pool-small">
        {status && <StatusDot state={status} data={{ 'data-composer-availability': true }} />}
        {parts.map((part, index) => (
          <span key={index} className="pool-selector-part">
            {index > 0 && <span aria-hidden="true">{' · '}</span>}
            <span {...dataProps(part.data)}>{part.text}</span>
          </span>
        ))}
      </span>
      <span className="pool-selector-chevron">
        <IconGlyph name="chevron" />
      </span>
    </button>
  );
}

/** Measurements read aloud on focus: an icon and a short value each, with what it measures as its title. */
export function Readout({
  items,
  data,
}: {
  readonly items: ReadonlyArray<{ readonly icon: IconName; readonly text: string; readonly title: string | null; readonly data?: DataAttributes }>;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-readouts pool-row pool-gap-sm pool-caption" {...dataProps(data)}>
      {items.map((item, index) =>
        item.title ? (
          <span key={index} className="pool-readout pool-row pool-gap-xs" tabIndex={0} title={item.title} aria-label={item.title} {...dataProps(item.data)}>
            <Icon name={item.icon} size="sm" />
            <span>{item.text}</span>
          </span>
        ) : null,
      )}
    </div>
  );
}

export type MenuItem = { readonly label: string; readonly onPress: () => void; readonly data?: DataAttributes };

/** A small menu of actions behind one button; choosing one or Escape closes it and returns focus to the button, and focus leaving it closes it. */
export function Menu({ label, items, data }: { readonly label: string; readonly items: ReadonlyArray<MenuItem>; readonly data?: DataAttributes }) {
  const details = useRef<HTMLDetailsElement>(null);
  const id = useId();
  const close = () => {
    const node = details.current;
    if (!node) return;
    node.open = false;
    node.querySelector('summary')?.focus();
  };
  return (
    <details
      className="pool-menu"
      ref={details}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && details.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
      // Focus leaving the menu (Tab past its last action, or a click elsewhere) folds it away without moving focus back.
      onBlur={(event) => {
        const node = details.current;
        if (node?.open && !(event.relatedTarget instanceof Node && node.contains(event.relatedTarget))) node.open = false;
      }}
      {...dataProps(data)}
    >
      <summary className="pool-button btn-ghost pool-icon" aria-label={label} title={label} aria-controls={id}>
        <IconGlyph name="more" />
      </summary>
      <div className="pool-menu-panel pool-surface pool-stack pool-gap-xs" id={id}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            className="pool-button btn-ghost"
            onClick={() => {
              close();
              item.onPress();
            }}
            {...dataProps(item.data)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

/**
 * One conversation in the Threads list: a monogram with its state mark, the title over one digest
 * line, the time of the last activity, and its actions menu. Exactly one row is current.
 */
export function ThreadItem({
  title,
  digest,
  monogram,
  time,
  timestamp,
  mark,
  activity = 'idle',
  current = false,
  label,
  onPress,
  menu,
  data,
}: {
  readonly title: string;
  readonly digest: string;
  readonly monogram: string;
  readonly time: string;
  /** The time of the last activity, as an ISO date for the time element and its tooltip. */
  readonly timestamp?: { readonly iso: string; readonly title: string } | null;
  readonly mark?: 'working' | 'unread' | 'attention' | null;
  readonly activity?: 'idle' | 'executing';
  readonly current?: boolean;
  readonly label: string;
  readonly onPress: () => void;
  readonly menu?: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-thread">
      <button
        type="button"
        className="pool-button btn-ghost pool-activity-edge pool-thread-item"
        aria-current={current ? 'true' : 'false'}
        aria-label={label}
        data-activity={activity}
        onClick={onPress}
        {...dataProps(data)}
      >
        <span className="pool-thread-title pool-small">{title}</span>
        <small className="pool-thread-digest pool-caption pool-muted">{digest}</small>
        <span className="pool-thread-monogram pool-caption" aria-hidden="true" data-thread-monogram="">
          {monogram}
          {mark && <span className={cx('pool-thread-mark', 'pool-dot', mark === 'working' && 'pool-dot-pulse', mark === 'attention' && 'pool-dot-open')} data-thread-mark={mark} />}
        </span>
        {time && (
          <time className="pool-thread-time pool-caption pool-muted" dateTime={timestamp?.iso} title={timestamp?.title}>
            {time}
          </time>
        )}
      </button>
      {menu}
    </div>
  );
}

/** One row of controls inside a field: they keep one line, and the last one sits at the end. */
export function Toolbar({ label, children, data }: { readonly label?: string; readonly children: ReactNode; readonly data?: DataAttributes }) {
  return (
    <div className="pool-toolbar" role={label ? 'toolbar' : undefined} aria-label={label} {...dataProps(data)}>
      {children}
    </div>
  );
}
