/** Bounded per-supplier totals for acquired model bytes. A supplier is a room participant id
 * (already public in the room) or a pinned origin label such as `origin:<repo>@<revision>`;
 * never an address. At most `maxSuppliers` distinct suppliers are named; further ones are
 * counted together under `other`. Labels that are not plain identifiers count as `unlabelled`. */
export const MAX_NAMED_SUPPLIERS = 16;
export const OTHER_SUPPLIERS = 'other';

export function supplierLabel(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_.:@/-]{1,160}$/.test(id) ? id : 'unlabelled';
}

/** Adds one verified piece of `bytes` from `id` to `summary` (a plain object, mutated). */
export function countSupplier(summary, id, bytes, maxSuppliers = MAX_NAMED_SUPPLIERS) {
  let label = supplierLabel(id);
  const named = Object.keys(summary).filter(key => key !== OTHER_SUPPLIERS).length;
  if (!Object.hasOwn(summary, label) && named >= maxSuppliers) label = OTHER_SUPPLIERS;
  const row = summary[label] ||= { pieces: 0, bytes: 0 };
  row.pieces++; row.bytes += bytes;
  return summary;
}
