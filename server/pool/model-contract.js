/**
 * @fileoverview Server adapter for the environment-neutral Pool model contract.
 *
 * The canonical contract has no browser side effects at module evaluation.
 * Keeping this adapter thin prevents the server from accepting an exact-model
 * requirement the browser would reject (or vice versa).
 */

export * from '../../shared/pool/model-contract.js';
export { default } from '../../shared/pool/model-contract.js';
