/** Helpers shared by the components. Not exported from the package entry. */

/** Stable `data-*` attributes callers attach for tests and routing; never styling. */
export type DataAttributes = Readonly<Record<`data-${string}`, string | number | boolean | undefined>>;

/** Joins primitive class names, skipping falsy entries. */
export const cx = (...names: ReadonlyArray<string | false | null | undefined>): string =>
  names.filter(Boolean).join(' ');

/** Only `data-*` keys survive, so a caller cannot pass styling through this channel. */
export function dataProps(data: DataAttributes | undefined): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!data) return out;
  for (const [key, value] of Object.entries(data)) {
    if (/^data-[a-z0-9-]+$/.test(key) && value !== undefined && value !== false) out[key] = value === true ? '' : value;
  }
  return out;
}

export type Gap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export const gapClass = (gap: Gap | undefined): string | undefined => (gap ? `pool-gap-${gap}` : undefined);
