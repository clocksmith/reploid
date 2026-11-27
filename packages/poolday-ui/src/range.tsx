import { useId } from 'react';
import { dataProps, type DataAttributes } from './internal.js';

/**
 * A value on a bounded scale, chosen by dragging or with the arrow keys; the current value is written beside the
 * track in the caller's words (`format`), so it is read as well as seen.
 */
export function RangeField({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  format = (current: number) => String(current),
  disabled = false,
  data,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
  readonly format?: (value: number) => string;
  readonly disabled?: boolean;
  readonly data?: DataAttributes;
}) {
  const id = useId();
  return (
    <div className="pool-row pool-gap-sm pool-range-field">
      <label className="pool-small" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="pool-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        {...dataProps(data)}
      />
      <output className="pool-small pool-mono" htmlFor={id}>
        {format(value)}
      </output>
    </div>
  );
}
