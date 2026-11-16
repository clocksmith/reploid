export interface CanonicalJsonOptions {
  /** Signed records reject undefined. General JSON may omit object members and emit null elsewhere. */
  undefinedValues?: 'reject' | 'json';
}
export function canonicalizeWith(compare?: (left: string, right: string) => number,
  options?: CanonicalJsonOptions): (value: unknown) => string;
export const canonicalize: (value: unknown) => string;
export default canonicalize;
