import { dataProps, type DataAttributes } from './internal.js';

/** Measured values as tiles: a caption over a large value, in columns that fold on narrow screens. */
export function Stats({
  label,
  items,
  data,
}: {
  /** Names the group for assistive technology. */
  readonly label: string;
  readonly items: ReadonlyArray<readonly [term: string, value: string]>;
  readonly data?: DataAttributes;
}) {
  return (
    <dl className="pool-stats pool-columns pool-gap-sm" aria-label={label} {...dataProps(data)}>
      {items.map(([term, value]) => (
        <div key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
