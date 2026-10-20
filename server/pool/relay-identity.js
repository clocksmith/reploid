/**
 * @fileoverview Shared immutable relay identity rules for pool stores.
 */

export function resolveIdempotentRelay(existing, incoming, kind) {
  if (!existing) return null;
  if (existing.idempotencyHash && incoming.idempotencyHash === existing.idempotencyHash) return existing;
  const error = new Error(`${kind} id is already bound to a different relay payload`);
  error.code = 'relay_id_conflict';
  throw error;
}
