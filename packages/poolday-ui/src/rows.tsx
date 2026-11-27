import { useId, type ReactNode } from 'react';
import { Icon, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

/** Internal row text pair shared by ListItem, Disclosure, SingleChoice, MultiChoice and Toggle. */
export function RowText({
  title,
  status,
  htmlFor,
  titleId,
  statusId,
  statusData,
  alwaysStatus = false,
}: {
  readonly title: ReactNode;
  readonly status?: ReactNode;
  readonly htmlFor?: string;
  readonly titleId?: string;
  readonly statusId?: string;
  readonly statusData?: DataAttributes;
  readonly alwaysStatus?: boolean;
}) {
  const inner = (
    <>
      <span className="pool-row-title" id={titleId}>
        {title}
      </span>
      {(alwaysStatus || status !== undefined) && (
        <span className="pool-row-status" id={statusId} {...dataProps(statusData)}>
          {status}
        </span>
      )}
    </>
  );
  return htmlFor ? (
    <label className="pool-row-text" htmlFor={htmlFor}>
      {inner}
    </label>
  ) : (
    <span className="pool-row-text">{inner}</span>
  );
}

/**
 * A panel is a column of Sections. A Section is a small uppercase title over one List of rows on a
 * quiet film, with an optional note below. Never box a group twice.
 */
export function Section({
  title,
  note,
  children,
  data,
}: {
  readonly title: string;
  readonly note?: ReactNode;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  const id = useId();
  return (
    <section className="pool-section" aria-labelledby={id} {...dataProps(data)}>
      <h3 className="pool-section-title" id={id}>
        {title}
      </h3>
      {children}
      {note !== undefined && <p className="pool-section-note">{note}</p>}
    </section>
  );
}

/** Rows that belong together, separated by hairlines; `gap` spaces rows that hold controls. */
export function List({ children, gap, data }: { readonly children: ReactNode; readonly gap?: 'xs' | 'sm'; readonly data?: DataAttributes }) {
  return (
    <div className={cx('pool-group', gap && `pool-gap-${gap}`)} {...dataProps(data)}>
      {children}
    </div>
  );
}

/**
 * One row of the alignment grid: [icon] [title over one status line] [trailing]. With `href` it is
 * a destination and ends in a chevron; with `onPress` it is an action; with neither it is static.
 */
export function ListItem({
  title,
  status,
  icon,
  href,
  onPress,
  trailing,
  current = false,
  disabled = false,
  label,
  data,
}: {
  readonly title: ReactNode;
  readonly status?: ReactNode;
  readonly icon?: IconName;
  readonly href?: string;
  readonly onPress?: () => void;
  /** Shown in the trailing slot: a badge, a time or a count. Never another control. */
  readonly trailing?: ReactNode;
  /** The one selected row of a navigation list. */
  readonly current?: boolean;
  readonly disabled?: boolean;
  /** Accessible name, when the visible title and status are not enough. */
  readonly label?: string;
  readonly data?: DataAttributes;
}) {
  const text = <RowText title={title} status={status} />;
  const leading = icon ? <Icon name={icon} /> : null;
  if (href !== undefined) {
    return (
      <a
        className="pool-action-row pool-plain"
        href={href}
        aria-current={current ? 'page' : undefined}
        aria-label={label}
        {...dataProps(data)}
      >
        {leading}
        {text}
        {trailing ?? <Icon name="next" size="sm" />}
      </a>
    );
  }
  if (onPress) {
    return (
      <button
        type="button"
        className="pool-action-row"
        onClick={onPress}
        disabled={disabled}
        aria-current={current ? 'true' : undefined}
        aria-label={label}
        {...dataProps(data)}
      >
        {leading}
        {text}
        <span className="pool-row-trailing">{trailing}</span>
      </button>
    );
  }
  return (
    <div className={cx('pool-action-row', 'pool-row-static')} aria-label={label} {...dataProps(data)}>
      {leading}
      {text}
      <span className="pool-row-trailing">{trailing}</span>
    </div>
  );
}

/** Show or hide more detail. `quiet` reads as a row inside a List. */
export function Disclosure({
  summary,
  status,
  quiet = false,
  defaultOpen = false,
  open,
  onToggle,
  children,
  statusData,
  data,
}: {
  /** A stable hook on the status beside the summary (a count), for tests and routing. */
  readonly statusData?: DataAttributes;
  readonly summary: string;
  readonly status?: string;
  readonly quiet?: boolean;
  readonly defaultOpen?: boolean;
  /** Controlled: the caller owns whether it is open and hears each toggle through `onToggle`. */
  readonly open?: boolean;
  /** Called with the new state whenever the person (or `open`) opens or closes it. */
  readonly onToggle?: (open: boolean) => void;
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <details
      className={cx('pool-disclosure', quiet && 'pool-disclosure-quiet')}
      open={(open ?? defaultOpen) || undefined}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      {...dataProps(data)}
    >
      <summary>
        {quiet ? (
          <RowText title={summary} status={status} statusData={statusData} />
        ) : (
          <>
            {summary}
            {status !== undefined && <span {...dataProps(statusData)}>{status}</span>}
          </>
        )}
      </summary>
      <div className="pool-stack pool-gap-sm">{children}</div>
    </details>
  );
}
