/**
 * The attempt report a requester host sends to accounting for one bound route
 * attempt. The host earning client writes it; the credit ledger reads it.
 */
export { ROUTE_ATTEMPT_SCHEMA } from '../mesh/partitions/partition-contract.js';

export const ATTEMPT_REPORT_SCHEMA = 'reploid.attempt-report/v1';

/** A failure code a report may name; a host reports anything else as EXECUTION_FAILED. */
export const FAILURE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
