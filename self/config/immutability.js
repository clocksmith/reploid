/**
 * @fileoverview Small immutable collection helpers for config contracts.
 */

export const freezeArray = (items = []) => Object.freeze([...items]);

export const extendIds = (...groups) => Object.freeze([...new Set(groups.flat())]);
