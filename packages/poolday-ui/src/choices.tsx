import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Icon, IconGlyph, type IconName } from './icon.js';
import { cx, dataProps, type DataAttributes } from './internal.js';
import { RowText } from './rows.js';

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
  /** One step deeper from this option (for example, who serves a model): an icon action at the row's end. */
  readonly action?: { readonly label: string; readonly icon: IconName; readonly onPress: () => void; readonly data?: DataAttributes };
  readonly data?: DataAttributes;
  /** Stable hooks on the native input and on the status line themselves, for tests and routing. */
  readonly inputData?: DataAttributes;
  readonly statusData?: DataAttributes;
};

/** Options under a heading inside one SingleChoice; a folded group shows its count and opens on demand. */
export type ChoiceGroup<T extends string> = {
  readonly id: string;
  readonly label: string;
  readonly options: ReadonlyArray<ChoiceOption<T>>;
  readonly folded?: boolean;
  /** For a folded group: open now (it holds the chosen option, or it is the only group). */
  readonly open?: boolean;
  /** The line an empty group shows, so a group never appears or vanishes as data loads. */
  readonly empty?: string;
};

/** How a choice was made: arrow keys browse without committing; a click, tap or Enter commits. */
export type ChoiceInput = { readonly browsing: boolean };

function OptionRow<T extends string>({
  name,
  type,
  option,
  checked,
  onToggle,
  baseId,
  onReselect,
  autoFocus = false,
}: {
  readonly name: string;
  readonly type: 'radio' | 'checkbox';
  readonly option: ChoiceOption<T>;
  readonly checked: boolean;
  readonly onToggle: (value: T, checked: boolean) => void;
  readonly baseId: string;
  /** A click on the option that is already chosen: native radios report no change, but it is still a choice. */
  readonly onReselect?: (value: T) => void;
  /** Marks the chosen input as the control a dialog focuses when it opens. */
  readonly autoFocus?: boolean;
}) {
  const id = `${baseId}-${option.value}`;
  const statusId = `${id}-status`;
  const fixShown = Boolean(option.disabled && option.fix);
  const row = (
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
        data-autofocus={autoFocus && checked ? '' : undefined}
        {...dataProps(option.inputData)}
        onChange={(event) => onToggle(option.value, event.currentTarget.checked)}
        onClick={(event) => {
          if (checked && event.currentTarget.checked && !option.disabled) onReselect?.(option.value);
        }}
      />
      <RowText
        htmlFor={id}
        title={option.title}
        titleId={`${id}-title`}
        status={option.status}
        statusId={statusId}
        statusData={option.statusData}
        alwaysStatus
      />
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
  if (!option.action) return row;
  return (
    <div className="pool-choice-row">
      {row}
      <button
        type="button"
        className="pool-button btn-ghost pool-icon pool-option-action"
        aria-label={option.action.label}
        title={option.action.label}
        onClick={option.action.onPress}
        {...dataProps(option.action.data)}
      >
        <IconGlyph name={option.action.icon} />
      </button>
    </div>
  );
}

/** Exactly one of a set. With `groups`, the options sit under headings in one group of radios. */
export function SingleChoice<T extends string>({
  label,
  labelHidden = false,
  value,
  onChange,
  onCommit,
  options = [],
  groups,
  layout = 'list',
  disabled = false,
  autoFocusChecked = false,
  data,
}: {
  /** In a dialog: the chosen option takes focus when it opens, as a list picker should. */
  readonly autoFocusChecked?: boolean;
  readonly label: string;
  readonly labelHidden?: boolean;
  readonly value: T | null;
  readonly onChange: (value: T, input: ChoiceInput) => void;
  /** Enter on an option, or a click on the one already chosen: apply it. */
  readonly onCommit?: (value: T) => void;
  readonly options?: ReadonlyArray<ChoiceOption<T>>;
  readonly groups?: ReadonlyArray<ChoiceGroup<T>>;
  readonly layout?: 'list' | 'segmented';
  readonly disabled?: boolean;
  readonly data?: DataAttributes;
}) {
  const baseId = useId();
  const browsing = useRef(false);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    browsing.current = event.key.startsWith('Arrow');
    const target = event.target as HTMLInputElement;
    if (event.key === 'Enter' && target.type === 'radio' && onCommit) {
      event.preventDefault();
      onCommit(target.value as T);
    }
  };
  const choose = (next: T) => onChange(next, { browsing: browsing.current });
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
              onChange={() => choose(option.value)}
            />
            {option.title}
          </label>
        ))}
      </div>
    );
  }
  const labelId = `${baseId}-label`;
  const row = (option: ChoiceOption<T>) => (
    <OptionRow
      key={option.value}
      name={baseId}
      type="radio"
      option={disabled ? { ...option, disabled: true } : option}
      checked={value === option.value}
      onToggle={(next) => choose(next)}
      onReselect={onCommit}
      autoFocus={autoFocusChecked}
      baseId={baseId}
    />
  );
  return (
    <div
      className="pool-options"
      role="radiogroup"
      aria-labelledby={labelId}
      onKeyDown={onKeyDown}
      onPointerDown={() => {
        browsing.current = false;
      }}
      {...dataProps(data)}
    >
      <p className={cx('pool-options-label', labelHidden && 'pool-visually-hidden')} id={labelId}>
        {label}
      </p>
      {groups
        ? groups.map((group) =>
            group.folded ? (
              <details key={group.id} className="pool-stack pool-gap-xs pool-option-group" open={group.open || undefined} role="group" aria-label={group.label} data-choice-group={group.id}>
                <summary className="pool-options-label">{group.label}</summary>
                {group.options.map(row)}
              </details>
            ) : (
              <div key={group.id} className="pool-stack pool-gap-xs pool-option-group" role="group" aria-label={group.label} data-choice-group={group.id}>
                <p className="pool-options-label">{group.label}</p>
                {group.options.length === 0 && group.empty ? <p className="pool-small pool-muted pool-option-empty">{group.empty}</p> : null}
                {group.options.map(row)}
              </div>
            ),
          )
        : options.map(row)}
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
  controlData,
  data,
}: {
  readonly title: string;
  readonly status?: ReactNode;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly icon?: IconName;
  /** Stable hooks on the switch itself. */
  readonly controlData?: DataAttributes;
  readonly data?: DataAttributes;
}) {
  const id = useId();
  return (
    <div className="pool-toggle-row" {...dataProps(data)}>
      {icon && <Icon name={icon} />}
      <RowText title={title} titleId={`${id}-title`} status={status} statusId={`${id}-status`} alwaysStatus />
      <button
        type="button"
        className="pool-switch"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-status`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        {...dataProps(controlData)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
