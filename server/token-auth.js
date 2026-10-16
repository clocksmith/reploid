import { timingSafeEqual } from 'node:crypto';

/** Compare already-normalized tokens; do not coerce absent or non-string input. */
export const tokensEqual = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
};
