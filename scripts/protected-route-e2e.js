#!/usr/bin/env node
/**
 * Fleet run of the protected route (research, unreviewed): a requester on one machine, an evaluator peer that computes
 * with Doppler's JavaScript WebGPU evaluator, whole or split across two machines (stage A, stage B). Every Doppler piece
 * is its JavaScript tooling from a Doppler checkout (`tools/privacy-protected`, branch protected-route-js).
 *
 * 1. Trap oracle host (a host the evaluator cannot see into):
 *      node <doppler>/tools/privacy-protected/pp.js trap-oracle --key oracle.key --new-key --listen 0.0.0.0:7462
 *    It prints its Ed25519 key. Then the pins, on any machine with the public model (not the requester process):
 *      node scripts/protected-route-e2e.js pins --doppler <doppler> --profile research-n16-u32 \
 *        --oracle http://<oracle-host>:7462 --oracle-key <key the oracle host printed> --prompt kpd --generate 6 --out pins.json
 *    The key is given out of band, never taken from the endpoint it authenticates; pins refuses an oracle that
 *    answers with another key.
 * 2. Programs for the schedule (prompt length L, G generated tokens), on each evaluator machine:
 *      node <doppler>/tools/privacy-protected/pp.js gpu-compile --profile research-n16-u32 --positions L --decode-through L+G-2 --out prog
 * 3. Evaluators. Split: stage B on its machine, then stage A pointed at stage B's hop address:
 *      node <doppler>/tools/privacy-protected/webgpu/evaluator.js --program prog --role stage-b --hop-listen 0.0.0.0:7712 --sessions 0 --timing overlap
 *      node <doppler>/tools/privacy-protected/webgpu/evaluator.js --program prog --role stage-a --next <stage-b-host>:7712 --sessions 0 --timing overlap
 *    Then the evaluator peer (a Reploid identity) in front of them:
 *      node server/protected-route/evaluator-peer.js --doppler <doppler> --profile research-n16-u32 --identity-file evaluator.json \
 *        --stage-a <a> --stage-b <b> --listen 0.0.0.0:7461
 *    (or --evaluator <whole> for one evaluator, or --program prog [--split] to start them here). Add --misbehave
 *    lie-random | lie-all | tamper | lie-lane=N | ask-decrypt | replay-result | wrong-identity for the negative runs.
 * 4. Requester:
 *      node scripts/protected-route-e2e.js run --doppler <doppler> --pins pins.json --endpoint <peer-host>:7461 \
 *        --prompt kpd --generate 6 --state-dir requester-state --report report.json [--expect RESULT_UNVERIFIED]
 *    The requester loads no weights: only the pins, the tokenizer alphabet and its own key holder (Doppler's pp.js bridge).
 *
 * The transport is plain TCP; every frame is signed and bound, and inputs and results are ciphertexts, but the
 * route remains unavailable to products until independent security review.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createInference } from '../shared/vendor/reploid/inference/index.js';
import { createNodeProtectedExecution } from '../server/protected-route/requester-host.js';
import { describeDopplerEngine, dopplerReference } from '../server/protected-route/doppler-tooling.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  doppler: { type: 'string' }, model: { type: 'string' }, profile: { type: 'string', default: 'research-n16-u32' },
  oracle: { type: 'string' }, 'oracle-key': { type: 'string' }, out: { type: 'string', default: 'pins.json' }, pins: { type: 'string' },
  endpoint: { type: 'string', multiple: true }, prompt: { type: 'string', default: 'bdf' }, generate: { type: 'string', default: '4' },
  'state-dir': { type: 'string' }, report: { type: 'string', default: 'protected-route-report.json' }, expect: { type: 'string' },
  'trap-lanes': { type: 'string', default: '3' }
} });
const fail = message => { console.error(message); process.exit(2); };

/** The requester's pins from Doppler's constants and the pinned oracle; written before any session. */
async function createPins({ doppler, model = null, profile, oracle, oracleKey, prompt, generate, trapLanes }) {
  const descriptor = await (await fetch(new URL('/v1/descriptor', oracle))).json();
  if (descriptor.oracleKey !== oracleKey) throw new Error('the oracle answers with a key other than the one given out of band');
  const manifest = await describeDopplerEngine({ doppler, profile, model });
  if (descriptor.circuit !== manifest.circuit) throw new Error(`the oracle serves circuit ${descriptor.circuit}, the engine computes ${manifest.circuit}`);
  return { schema: 'reploid.protected-route-pins/v1', profile: manifest.profile, modelIdentity: manifest.model,
    policy: { protocols: ['reploid.protected-generation/v1'], engines: [manifest.protocol],
      parameterSets: [{ id: manifest.profile, digest: manifest.profileDigest, insecureDevelopment: manifest.insecureDevelopment }],
      allowInsecureDevelopment: manifest.insecureDevelopment,
      circuits: [{ identity: manifest.circuit, modelIdentity: manifest.model, tokenizer: { alphabet: manifest.alphabet }, vocab: manifest.vocab,
        context: manifest.context, inputLevel: manifest.inputLevel, logSlots: manifest.logSlots, rotations: [...manifest.rotations],
        traps: { source: 'oracle', endpoint: oracle, oracleKeys: [oracleKey] } }],
      trapLanes, maxTrapTolerance: 1, maxKeyEpochSeconds: 86400, allowPublicTrapSet: false },
    reference: await dopplerReference({ doppler, model, prompt, generate }) };
}

/** Seconds between streamed tokens (decode), after the first token. */
const gaps = times => times.slice(1).map((at, i) => (at - times[i]) / 1000);
const median = list => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };

if (positionals[0] === 'pins') {
  if (!values.doppler || !values.oracle || !values['oracle-key']) fail('pins needs --doppler, --oracle and --oracle-key');
  const pins = await createPins({ doppler: values.doppler, model: values.model ?? null, profile: values.profile, oracle: values.oracle,
    oracleKey: values['oracle-key'], prompt: values.prompt, generate: Number(values.generate), trapLanes: Number(values['trap-lanes']) });
  writeFileSync(values.out, JSON.stringify(pins, null, 1));
  console.log(`wrote ${values.out}: circuit ${pins.policy.circuits[0].identity}, parameter set ${pins.profile}, reference ${pins.reference.approximateText}`);
} else if (positionals[0] === 'run') {
  if (!values.doppler || !values.pins || !values.endpoint?.length) fail('run needs --doppler, --pins and --endpoint');
  const pins = JSON.parse(readFileSync(values.pins, 'utf8'));
  const protectedExecution = createNodeProtectedExecution({ endpoints: values.endpoint, doppler: values.doppler, policy: pins.policy,
    stateDir: values['state-dir'] ?? null, unreviewedProtectedExecution: true });
  const inference = createInference({ resolveRoute() { throw new Error('plaintext route'); }, execute() { throw new Error('plaintext executor'); },
    protectedExecution, unreviewedProtectedExecution: true });
  const started = Date.now();
  const plan = await inference.prepare({ model: { id: 'doppler-protected-tiny', identity: pins.modelIdentity },
    generation: { maxOutputTokens: Number(values.generate) }, execution: { protection: 'homomorphic', route: 'remote',
      participants: { kind: 'open' }, allowMetadata: ['model-id', 'timing', 'length'] } });
  const handle = await inference.run({ planId: plan.id, requestId: `fleet-${started}`, input: { messages: [{ role: 'user', content: values.prompt }] } });
  const events = [];
  for await (const event of handle.events) {
    events.push({ type: event.type, at: Date.now() - started, ...(event.type === 'output.delta' ? { sequence: event.sequence } : {}) });
    if (event.type === 'output.delta') process.stdout.write(event.text);
  }
  const result = await handle.result;
  process.stdout.write('\n');
  const reference = pins.reference?.prompt === values.prompt ? pins.reference : null;
  const matches = result.status === 'completed' && reference !== null && result.output.text === reference.approximateText;
  const tokenTimes = events.filter(event => event.type === 'output.delta').map(event => event.at);
  const decode = gaps(tokenTimes);
  const timing = { totalSeconds: (Date.now() - started) / 1000, firstTokenSeconds: tokenTimes.length ? tokenTimes[0] / 1000 : null,
    decodeSecondsPerToken: decode, medianDecodeSecondsPerToken: median(decode),
    wallSecondsPerToken: tokenTimes.length ? tokenTimes.at(-1) / 1000 / tokenTimes.length : null };
  // The report keeps the prompt and answer because the operator chose them for this check; the protected journals do not.
  writeFileSync(values.report, JSON.stringify({ schema: 'reploid.protected-route-run/v1', at: new Date(started).toISOString(),
    plan: { protection: plan.protection, routeKind: plan.routeKind, route: plan.route, disclosure: plan.disclosure },
    events, status: result.status, error: result.error ?? null, output: result.output, reference, matchesReference: matches,
    matchesExactReference: result.status === 'completed' && reference !== null && result.output.text === reference.exactText,
    timing, receipt: result.executionReceipt, journal: protectedExecution.journal.entries() }, null, 1));
  const ok = values.expect ? result.status === 'failed' && result.error?.code === values.expect : matches;
  console.log(`${result.status}${result.error ? ` ${result.error.code}: ${result.error.message}` : ''}; reference match ${matches}; `
    + `median decode ${timing.medianDecodeSecondsPerToken?.toFixed(2) ?? '-'} s/token; report ${values.report}`);
  process.exit(ok ? 0 : 1);
} else {
  fail('usage: protected-route-e2e.js pins|run [flags] (see the header of this file)');
}
