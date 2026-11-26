import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx, dataProps, type DataAttributes } from './internal.js';

type FieldProps = {
  readonly label: string;
  /** Keep the name for assistive technology but show no visible label. */
  readonly labelHidden?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  /** Shown beneath the field and announced; also marks the field invalid. */
  readonly error?: string | undefined;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly required?: boolean;
  readonly maxLength?: number;
  readonly autoFocus?: boolean;
  readonly data?: DataAttributes;
};

function FieldFrame({
  id,
  label,
  labelHidden,
  hint,
  error,
  children,
}: {
  readonly id: string;
  readonly label: string;
  readonly labelHidden: boolean;
  readonly hint: string | undefined;
  readonly error: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="pool-stack pool-gap-xs">
      <label className={cx('pool-small', labelHidden && 'pool-visually-hidden')} htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="pool-caption pool-muted" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {/* Present before any message, so the first error is announced too. */}
      <p className="pool-caption" id={`${id}-error`} aria-live="polite">
        {error}
      </p>
    </div>
  );
}

const describedBy = (id: string, hint: string | undefined, error: string | undefined) =>
  [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined;

/** A labelled single-line text field. The caller owns the value. */
export function Field({
  type = 'text',
  autoComplete,
  label,
  labelHidden = false,
  value,
  onChange,
  hint,
  error,
  placeholder,
  disabled,
  readOnly,
  required,
  maxLength,
  autoFocus,
  min,
  max,
  spellCheck,
  data,
}: FieldProps & {
  readonly type?: 'text' | 'search' | 'url' | 'email' | 'password' | 'number';
  readonly autoComplete?: string;
  /** Bounds of a number field. */
  readonly min?: number;
  readonly max?: number;
  /** Off for identifiers and codes, which are not words. */
  readonly spellCheck?: boolean;
}) {
  const id = useId();
  return (
    <FieldFrame id={id} label={label} labelHidden={labelHidden} hint={hint} error={error}>
      <input
        id={id}
        className="pool-input"
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        min={min}
        max={max}
        spellCheck={spellCheck}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...dataProps(data)}
      />
    </FieldFrame>
  );
}

/**
 * A labelled multi-line field. With `onSubmit`, Enter submits and Shift+Enter adds a line, as a
 * chat composer expects. `bare` drops the field's own material for use inside an InputGroup.
 */
export function TextArea({
  rows = 3,
  bare = false,
  onSubmit,
  label,
  labelHidden = false,
  value,
  onChange,
  hint,
  error,
  placeholder,
  disabled,
  readOnly,
  required,
  maxLength,
  autoFocus,
  focusSignal,
  describedBy: describedByExtra,
  data,
}: FieldProps & {
  readonly rows?: number;
  readonly bare?: boolean;
  readonly onSubmit?: () => void;
  /** Focuses the field each time this number changes (after a choice returns to the draft). */
  readonly focusSignal?: number;
  /** The id of text shown outside the field that describes it, read after the label. */
  readonly describedBy?: string;
}) {
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusSignal) field.current?.focus({ preventScroll: true });
  }, [focusSignal]);
  const onKeyDown = onSubmit
    ? (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSubmit();
        }
      }
    : undefined;
  return (
    <FieldFrame id={id} label={label} labelHidden={labelHidden} hint={hint} error={error}>
      <textarea
        id={id}
        ref={field}
        className={cx(bare ? 'pool-bare pool-body' : 'pool-input')}
        rows={rows}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        required={required}
        maxLength={maxLength}
        autoFocus={autoFocus}
        aria-invalid={error ? true : undefined}
        aria-describedby={[describedByExtra, describedBy(id, hint, error)].filter(Boolean).join(' ') || undefined}
        onKeyDown={onKeyDown}
        onChange={(event) => onChange(event.currentTarget.value)}
        {...dataProps(data)}
      />
    </FieldFrame>
  );
}

/**
 * One field made of several controls (the composer): the inset material with a prism edge, a
 * focus ring when any control inside has focus, and an activity edge while work runs.
 */
export function InputGroup({
  activity = 'idle',
  children,
  data,
}: {
  readonly activity?: 'idle' | 'ready' | 'executing';
  readonly children: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <div
      className="pool-input pool-glass pool-glass-focus pool-activity-edge pool-focus-within pool-input-group"
      data-activity={activity}
      {...dataProps(data)}
    >
      {children}
    </div>
  );
}
