#!/usr/bin/env node
/**
 * A stand-in for Doppler's secret-shared requester (tools/secret-shared/requester/requester.js `run`) in the harness
 * tests: the same command line and the same JSON events on stdout (ready, token, end, failed). Each step asks every
 * operator for that step and waits for every reply under --round-timeout-ms. A missed deadline is reported as Doppler
 * reports it (code operator-stalled, the stalled stage and share), every connection is closed, and the process exits 1.
 */
import fs from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ allowPositionals: true, options: { model: { type: 'string' }, plan: { type: 'string' }, operators: { type: 'string' },
  request: { type: 'string' }, out: { type: 'string' }, threads: { type: 'string' }, 'round-timeout-ms': { type: 'string', default: '300000' },
  'close-timeout-ms': { type: 'string' }, 'return-shift': { type: 'string' }, prg: { type: 'string' } } });
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
const ops = JSON.parse(fs.readFileSync(args.operators, 'utf8'));
const request = JSON.parse(fs.readFileSync(args.request, 'utf8'));
const timeoutMs = Number(args['round-timeout-ms']);
const PROMPT_TOKENS = 7;
let stop = false;
readline.createInterface({ input: process.stdin }).on('line', line => { if (line.trim() === 'stop') stop = true; });

function open(entry, where) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: entry.host, port: entry.port });
    const waiting = [];
    readline.createInterface({ input: socket }).on('line', line => waiting.shift()?.(JSON.parse(line)));
    socket.once('connect', () => resolve({ where, socket, call: message => new Promise(done => { waiting.push(done); socket.write(JSON.stringify(message) + '\n'); }) }));
    socket.once('error', reject);
  });
}

const all = [];
const within = (op, message) => Promise.race([op.call(message).then(reply => { if (reply.error) throw Error(reply.error); return reply; }),
  new Promise((_, reject) => setTimeout(() => reject(Object.assign(Error(`${message.op}: no reply from stage ${op.where.stage} share ${op.where.share} within ${timeoutMs} ms`),
    { code: 'operator-stalled', stalled: [op.where], timeoutMs })), timeoutMs).unref())]);
const t0 = performance.now();
let last = t0, rounds = 0;
try {
  for (const [stage, pair] of ops.stages.entries()) for (const [share, entry] of pair.entries()) all.push(await open(entry, { stage, share }));
  await Promise.all(all.map(op => within(op, { op: 'hello', token: ops.token })));
  emit({ event: 'ready', promptTokens: PROMPT_TOKENS, loadS: 0, stages: all.map(op => [op.where.stage, op.where.share, 'fake']) });
  let step = 0;
  for (; step < request.maxTokens; step++) {
    const columns = step === 0 ? PROMPT_TOKENS : 1;
    await Promise.all(all.map(op => within(op, { op: 'step', step, columns })));
    rounds += all.length;
    const done = step + 1 === request.maxTokens;
    last = performance.now();
    emit({ event: 'token', step, tokenId: 100 + step, delta: `w${step} `, done, stopReason: done ? 'max-tokens' : null, inputTokens: columns,
      wallMs: 1, cpuMs: 1, rounds: all.length, up: 0, down: 0, wireMs: 0, operatorMs: 0, margin: 1 });
    if (stop) { step++; break; }
  }
  for (const op of all) op.socket.destroy();
  const freshness = { rounds, distinctShareBDigests: rounds, countersStrictlyIncreasing: true };
  fs.writeFileSync(args.out, JSON.stringify({ schema: 'doppler.secret-shared-run/v1', requester: 'fake', freshness, protocol: { speculation: 'off' } }) + '\n');
  emit({ event: 'end', stopReason: stop ? 'requester-stop' : 'max-tokens', outputTokens: step, freshness, requesterPeakRss: 0 });
  process.exit(0);
} catch (error) {
  for (const op of all) op.socket.destroy();
  const failedAt = performance.now();
  emit({ event: 'failed', error: `${error.name}: ${error.message}`, code: error.code ?? null, stalled: error.stalled ?? null, timeoutMs: error.timeoutMs ?? null,
    sinceLastEventMs: failedAt - last, wallMs: failedAt - t0, cancelled: true, roundTimeoutMs: timeoutMs });
  process.exit(1);
}
