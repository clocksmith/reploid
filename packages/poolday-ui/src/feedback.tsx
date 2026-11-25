import type { ReactNode } from 'react';
import { cx, dataProps, type DataAttributes } from './internal.js';

/** Status tones, used sparingly: a dot or a badge, never a whole surface. */
export type Tone = 'neutral' | 'ready' | 'pending' | 'unavailable' | 'error';
const toneClass = (tone: Tone) => (tone === 'neutral' ? false : `pool-tone-${tone}`);

/** A small status label. */
export function Badge({ tone = 'neutral', children, data }: { readonly tone?: Tone; readonly children: ReactNode; readonly data?: DataAttributes }) {
  return (
    <span className={cx('pool-badge', toneClass(tone))} {...dataProps(data)}>
      {children}
    </span>
  );
}

/**
 * A message about the surface it sits on. Errors are alerts; everything else is a polite status.
 * The region is always rendered, so its first message is announced and the layout never jumps.
 */
export function Notice({
  tone = 'neutral',
  children,
  action,
  data,
}: {
  readonly tone?: Tone;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly data?: DataAttributes;
}) {
  const empty = children === undefined || children === null || children === false || children === '';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} {...dataProps(data)}>
      {!empty && (
        <div className="pool-well pool-row pool-row-between pool-gap-sm">
          <p className={cx('pool-small', toneClass(tone))}>{children}</p>
          {action}
        </div>
      )}
    </div>
  );
}

/** One line of status text whose height is reserved, so it never moves its neighbours. */
export function StatusLine({ children, muted = true, id, data }: { readonly children?: ReactNode; readonly muted?: boolean; readonly id?: string; readonly data?: DataAttributes }) {
  return (
    <p className={cx('pool-status-line', muted && 'pool-muted')} id={id} role="status" {...dataProps(data)}>
      {children}
    </p>
  );
}

/** Work in progress whose length is unknown. `label` names it for assistive technology. */
export function Spinner({ label }: { readonly label: string }) {
  return (
    <span className="pool-spinner-host" role="status">
      <span className="pool-spinner" aria-hidden="true" />
      <span className="pool-visually-hidden">{label}</span>
    </span>
  );
}

/** Measured progress; omit `value` while the total is unknown. */
export function Progress({ label, value, max = 1, data }: { readonly label: string; readonly value?: number | undefined; readonly max?: number | undefined; readonly data?: DataAttributes }) {
  return <progress className="pool-progress pool-progress-line" aria-label={label} value={value} max={value === undefined ? undefined : max} {...dataProps(data)} />;
}
