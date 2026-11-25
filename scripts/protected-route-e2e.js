#!/usr/bin/env node
/**
 * Two-machine run of the protected route (research, unreviewed): REFUSED.
 *
 * This script drove Doppler's Go `privacy-protected` binary (branch protected-route) as the requester's key holder,
 * the evaluator engine, the trap oracle and the pin generator. Reploid runs JavaScript only, so it no longer spawns
 * that binary. It refuses until JavaScript implementations of the key holder (`openKeyHolder` in
 * server/protected-route/requester-host.js) and the evaluator engine port (server/protected-route/evaluator-peer.js)
 * exist. The protocol, policy and journal code in reploid/inference is unchanged; see docs/confidential-execution.md.
 */
export const PROTECTED_ROUTE_E2E_REFUSAL = 'protected-route-e2e.js: refused. It drove Doppler\'s Go privacy-protected binary, '
  + 'and Reploid runs JavaScript only. It returns once a JavaScript key holder and evaluator engine exist.';

console.error(PROTECTED_ROUTE_E2E_REFUSAL);
process.exitCode = 2;
