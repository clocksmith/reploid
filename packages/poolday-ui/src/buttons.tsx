import { Icon, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

/**
 * Three weights: `primary` for the one commitment on a surface, `secondary` for other actions
 * that change something, `quiet` for Cancel, Refresh, Retry and navigation.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

const VARIANT_CLASS: Record<ButtonVariant, string | false> = {
  primary: 'btn-primary',
  secondary: false,
  quiet: 'btn-ghost',
};

type CommonButtonProps = {
  readonly variant?: ButtonVariant;
  /** Omit to disable the control. */
  readonly onPress?: (() => void) | undefined;
  readonly disabled?: boolean;
  readonly type?: 'button' | 'submit';
  /** A toggle button's state. */
  readonly pressed?: boolean;
  /** The current destination in a set of navigation buttons. */
  readonly current?: boolean;
  readonly expanded?: boolean;
  readonly hasPopup?: 'dialog' | 'menu';
  readonly controls?: string;
  readonly describedBy?: string;
  readonly data?: DataAttributes;
};

/** A labelled action, or a destination when `href` is given. */
export function Button({
  label,
  icon,
  href,
  pending = false,
  pendingLabel,
  variant = 'secondary',
  onPress,
  disabled = false,
  type = 'button',
  pressed,
  current,
  expanded,
  hasPopup,
  controls,
  describedBy,
  data,
}: CommonButtonProps & {
  readonly label: string;
  readonly icon?: IconName;
  readonly href?: string;
  readonly pending?: boolean;
  readonly pendingLabel?: string;
}) {
  const className = cx('pool-button', VARIANT_CLASS[variant]);
  const content = (
    <>
      {icon && <Icon name={icon} />}
      <span>{pending && pendingLabel ? pendingLabel : label}</span>
    </>
  );
  if (href !== undefined) {
    return (
      <a className={cx(className, 'pool-plain')} href={href} aria-current={current ? 'page' : undefined} {...dataProps(data)}>
        {content}
      </a>
    );
  }
  return (
    <button
      type={type}
      className={className}
      disabled={disabled || pending || (type === 'button' && !onPress)}
      onClick={onPress}
      aria-pressed={pressed}
      aria-current={current ? 'true' : undefined}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      aria-controls={controls}
      aria-describedby={describedBy}
      aria-busy={pending || undefined}
      aria-live={pending ? 'polite' : undefined}
      {...dataProps(data)}
    >
      {content}
    </button>
  );
}

/** A square icon control at the touch-target size. `label` is its accessible name. */
export function IconButton({
  label,
  icon,
  variant = 'quiet',
  onPress,
  disabled = false,
  type = 'button',
  pressed,
  expanded,
  hasPopup,
  controls,
  describedBy,
  data,
}: CommonButtonProps & { readonly label: string; readonly icon: IconName }) {
  return (
    <button
      type={type}
      className={cx('pool-button', 'pool-icon', VARIANT_CLASS[variant])}
      aria-label={label}
      title={label}
      disabled={disabled || (type === 'button' && !onPress)}
      onClick={onPress}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      aria-controls={controls}
      aria-describedby={describedBy}
      {...dataProps(data)}
    >
      <Icon name={icon} />
    </button>
  );
}

/** A suggestion the user can tap to fill the composer; lighter than a button. */
export function Chip({
  label,
  onPress,
  data,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly data?: DataAttributes;
}) {
  return (
    <button type="button" className="pool-chip" onClick={onPress} {...dataProps(data)}>
      {label}
    </button>
  );
}
