#!/usr/bin/env node
/**
 * Two-machine run of the protected route (research, unreviewed): a requester on one machine, an evaluator peer on
 * another, over the network. Doppler's `privacy-protected` binary (branch protected-route) must be built for each.
 *
 * 1. Trap oracle host (the publisher, or a host the evaluator cannot see into):
 *      <bin> trap-oracle --model tiny-model.json --key oracle.key --new-key --listen 0.0.0.0:7462
 *    Then the pins, on any machine with the public model (not the requester process):
 *      node scripts/protected-route-e2e.js pins --engine <bin> --model tiny-model.json --profile research-n16 \
 *        --oracle http://<oracle-host>:7462 --oracle-key <key the oracle host printed> --out pins.json
 *    writes the requester's pins: engine protocol, parameter-set digest, circuit layout, the oracle endpoint and the
 *    oracle's Ed25519 key. The key is given out of band (copied from the oracle host's own log), never taken from
 *    the endpoint it authenticates; pins refuses an oracle that answers with another key.
 * 2. Evaluator host:
 *      node server/protected-route/evaluator-peer.js --engine <bin> --model tiny-model.json --profile research-n16 \
 *        --identity-file evaluator.identity.json --listen 0.0.0.0:7461 --state-dir evaluator-state
 *    Add --misbehave lie-random | lie-all | ask-decrypt | replay-result | wrong-identity | vanish:<published trap set>
 *    for the negative runs.
 * 3. Requester:
 *      node scripts/protected-route-e2e.js run --engine <bin> --pins pins.json --endpoint <evaluator-host>:7461 \
 *        --prompt bdf --generate 4 --state-dir requester-state --report report.json [--expect RESULT_UNVERIFIED]
 *    The requester loads no weights: only the pins, the tokenizer alphabet and its own key holder.
 *
 * The transport is plain TCP; every frame is signed and bound, and inputs and results are ciphertexts, but the
 * route remains unavailable to products until independent security review.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createInference } from '../shared/vendor/reploid/inference/index.js';
import { createNodeProtectedExecution } from '../server/protected-route/requester-host.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  engine: { type: 'string' }, model: { type: 'string' }, profile: { type: 'string', default: 'research-n16' },
  oracle: { type: 'string' }, 'oracle-key': { type: 'string' }, out: { type: 'string', default: 'pins.json' }, pins: { type: 'string' },
  endpoint: { type: 'string', multiple: true }, prompt: { type: 'string', default: 'bdf' }, generate: { type: 'string', default: '4' },
  'state-dir': { type: 'string' }, report: { type: 'string', default: 'protected-route-report.json' }, expect: { type: 'string' },
  'trap-lanes': { type: 'string', default: '3' }
} });
const fail = message => { console.error(message); process.exit(2); };

if (positionals[0] === 'pins') {
  if (!values.engine || !values.model || !values.oracle || !values['oracle-key']) fail('pins needs --engine, --model, --oracle and --oracle-key');
  const oracle = await (await fetch(new URL('/v1/descriptor', values.oracle))).json();
  if (oracle.oracleKey !== values['oracle-key']) fail('the oracle answers with a key other than the one given out of band');
  const manifest = JSON.parse(execFileSync(values.engine, ['evaluator', '--describe', '--profile', values.profile, '--model', values.model]));
  const modelIdentity = 'sha256:' + createHash('sha256').update(readFileSync(values.model)).digest('hex');
  const pins = { schema: 'reploid.protected-route-pins/v1', profile: manifest.profile, modelIdentity,
    policy: { protocols: ['reploid.protected-generation/v1'], engines: [manifest.protocol],
      parameterSets: [{ id: manifest.profile, digest: manifest.profileDigest, insecureDevelopment: manifest.insecureDevelopment }],
      allowInsecureDevelopment: manifest.insecureDevelopment,
      circuits: [{ identity: manifest.circuit, modelIdentity, tokenizer: { alphabet: "abcdefghijklmnopqrstuvwxyz .,!?'" }, vocab: manifest.vocab,
        context: manifest.context, inputLevel: manifest.inputLevel, logSlots: manifest.logSlots, rotations: manifest.rotations,
        traps: { source: 'oracle', endpoint: values.oracle, oracleKeys: [values['oracle-key']] } }],
      trapLanes: Number(values['trap-lanes']), maxTrapTolerance: 1, maxKeyEpochSeconds: 86400, allowPublicTrapSet: false },
    reference: JSON.parse(execFileSync(values.engine, ['reference', '--model', values.model, '--prompt', values.prompt, '--generate', values.generate])) };
  writeFileSync(values.out, JSON.stringify(pins, null, 1));
  if (oracle.circuit !== manifest.circuit) fail(`the oracle serves circuit ${oracle.circuit}, the engine computes ${manifest.circuit}`);
  console.log(`wrote ${values.out}: circuit ${manifest.circuit}, parameter set ${manifest.profile}, oracle key ${oracle.oracleKey}, reference ${pins.reference.approximateText}`);
} else if (positionals[0] === 'run') {
  if (!values.engine || !values.pins || !values.endpoint?.length) fail('run needs --engine, --pins and --endpoint');
  const pins = JSON.parse(readFileSync(values.pins, 'utf8'));
  const protectedExecution = createNodeProtectedExecution({ endpoints: values.endpoint, engine: values.engine, policy: pins.policy,
    stateDir: values['state-dir'] ?? null, unreviewedProtectedExecution: true });
  const inference = createInference({ resolveRoute() { throw new Error('plaintext route'); }, execute() { throw new Error('plaintext executor'); },
    protectedExecution, unreviewedProtectedExecution: true });
  const started = Date.now();
  const plan = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: pins.modelIdentity },
    generation: { maxOutputTokens: Number(values.generate) }, execution: { placement: 'network-allowed', participants: { kind: 'open' },
      confidentiality: 'requester-only', allowMetadata: ['model-id', 'timing', 'length'] } });
  const handle = await inference.run({ planId: plan.id, requestId: `two-machine-${started}`, input: { messages: [{ role: 'user', content: values.prompt }] } });
  const events = [];
  for await (const event of handle.events) {
    events.push({ type: event.type, at: Date.now() - started, ...(event.type === 'output.delta' ? { sequence: event.sequence } : {}) });
    if (event.type === 'output.delta') process.stdout.write(event.text);
  }
  const result = await handle.result;
  process.stdout.write('\n');
  const matches = result.status === 'completed' && pins.reference?.prompt === values.prompt && result.output.text === pins.reference.approximateText;
  // The report keeps the prompt and answer because the operator chose them for this check; the protected journals do not.
  writeFileSync(values.report, JSON.stringify({ schema: 'reploid.protected-route-run/v1', at: new Date(started).toISOString(), plan: { route: plan.route, disclosures: plan.disclosures },
    events, status: result.status, error: result.error ?? null, output: result.output, matchesReference: matches,
    receipt: result.executionReceipt, journal: protectedExecution.journal.entries(), seconds: (Date.now() - started) / 1000 }, null, 1));
  const ok = values.expect ? result.status === 'failed' && result.error?.code === values.expect : matches;
  console.log(`${result.status}${result.error ? ` ${result.error.code}: ${result.error.message}` : ''}; reference match ${matches}; report ${values.report}`);
  process.exit(ok ? 0 : 1);
} else {
  fail('usage: protected-route-e2e.js pins|run [flags] (see the header of this file)');
}
