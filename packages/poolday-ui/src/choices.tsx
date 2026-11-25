import { useId, type ReactNode } from 'react';
import { Icon, IconGlyph, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

/**
 * Choice controls. Pick by the kind of decision, never by the look:
 * - exactly one of a list, or options that need a status line: SingleChoice (rows with a trailing check);
 * - exactly one of two to four short modes: SingleChoice with `layout="segmented"`;
 * - any number of independent options: MultiChoice (rows with a check box);
 * - on or off with immediate effect: Toggle (a switch).
 * Every choice is a native radio or checkbox, so arrow keys, focus and roles come from the platform.
 */
export type ChoiceOption<T extends string> = {
  readonly value: T;
  readonly title: string;
  /** One status line beneath the title; it keeps its height when empty and carries a disabled reason. */
  readonly status?: ReactNode;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** For a disabled option: the action that makes it available, shown where the check would be. */
  readonly fix?: { readonly label: string; readonly onPress: () => void };
  readonly data?: DataAttributes;
};

function OptionRow<T extends string>({
  name,
  type,
  option,
  checked,
  onToggle,
  baseId,
}: {
  readonly name: string;
  readonly type: 'radio' | 'checkbox';
  readonly option: ChoiceOption<T>;
  readonly checked: boolean;
  readonly onToggle: (value: T, checked: boolean) => void;
  readonly baseId: string;
}) {
  const id = `${baseId}-${option.value}`;
  const statusId = `${id}-status`;
  const fixShown = Boolean(option.disabled && option.fix);
  return (
    <div className="pool-option" {...dataProps(option.data)}>
      {option.icon && <Icon name={option.icon} />}
      <input
        type={type}
        id={id}
        name={name}
        value={option.value}
        checked={checked}
        disabled={option.disabled}
        aria-labelledby={`${id}-title`}
        aria-describedby={statusId}
        onChange={(event) => onToggle(option.value, event.currentTarget.checked)}
      />
      <label className="pool-row-text" htmlFor={id}>
        <span className="pool-row-title" id={`${id}-title`}>
          {option.title}
        </span>
        <span className="pool-row-status" id={statusId}>
          {option.status}
        </span>
      </label>
      <span className="pool-option-mark" aria-hidden="true">
        <IconGlyph name="check" />
      </span>
      {fixShown && option.fix && (
        <button type="button" className="pool-button btn-ghost pool-option-fix" onClick={option.fix.onPress}>
          {option.fix.label}
        </button>
      )}
    </div>
  );
}

/** Exactly one of a set. */
export function SingleChoice<T extends string>({
  label,
  labelHidden = false,
  value,
  onChange,
  options,
  layout = 'list',
  disabled = false,
  data,
}: {
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly value: T | null;
  readonly onChange: (value: T) => void;
  readonly options: ReadonlyArray<ChoiceOption<T>>;
  readonly layout?: 'list' | 'segmented';
  readonly disabled?: boolean;
  readonly data?: DataAttributes;
}) {
  const baseId = useId();
  if (layout === 'segmented') {
    return (
      <div className="pool-segmented" role="radiogroup" aria-label={label} {...dataProps(data)}>
        {options.map((option) => (
          <label className="pool-segment" key={option.value} {...dataProps(option.data)}>
            <input
              type="radio"
              name={baseId}
              value={option.value}
              checked={value === option.value}
              disabled={disabled || option.disabled}
              onChange={() => onChange(option.value)}
            />
            {option.title}
          </label>
        ))}
      </div>
    );
  }
  const labelId = `${baseId}-label`;
  return (
    <div className="pool-options" role="radiogroup" aria-labelledby={labelId} {...dataProps(data)}>
      <p className={cx('pool-options-label', labelHidden && 'pool-visually-hidden')} id={labelId}>
        {label}
      </p>
      {options.map((option) => (
        <OptionRow
          key={option.value}
          name={baseId}
          type="radio"
          option={disabled ? { ...option, disabled: true } : option}
          checked={value === option.value}
          onToggle={(next) => onChange(next)}
          baseId={baseId}
        />
      ))}
    </div>
  );
}

/** Any number of independent options. */
export function MultiChoice<T extends string>({
  label,
  labelHidden = false,
  values,
  onChange,
  options,
  data,
}: {
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly values: ReadonlyArray<T>;
  readonly onChange: (values: T[]) => void;
  readonly options: ReadonlyArray<ChoiceOption<T>>;
  readonly data?: DataAttributes;
}) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const toggle = (value: T, checked: boolean) => {
    const next = options.map((option) => option.value).filter((item) => (item === value ? checked : values.includes(item)));
    onChange(next);
  };
  return (
    <div className="pool-options pool-options-multi" role="group" aria-labelledby={labelId} {...dataProps(data)}>
      <p className={cx('pool-options-label', labelHidden && 'pool-visually-hidden')} id={labelId}>
        {label}
      </p>
      {options.map((option) => (
        <OptionRow
          key={option.value}
          name={`${baseId}-${option.value}`}
          type="checkbox"
          option={option}
          checked={values.includes(option.value)}
          onToggle={toggle}
          baseId={baseId}
        />
      ))}
    </div>
  );
}

/** An on/off setting that takes effect immediately: title, one status line and a switch. */
export function Toggle({
  title,
  status,
  checked,
  onChange,
  disabled = false,
  icon,
  data,
}: {
  readonly title: string;
  readonly status?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  readonly data?: DataAttributes;
}) {
  const id = useId();
  return (
    <div className="pool-toggle-row" {...dataProps(data)}>
      {icon && <Icon name={icon} />}
      <span className="pool-row-text">
        <span className="pool-row-title" id={`${id}-title`}>
          {title}
        </span>
        <span className="pool-row-status" id={`${id}-status`}>
          {status}
        </span>
      </span>
      <button
        type="button"
        className="pool-switch"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-status`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
