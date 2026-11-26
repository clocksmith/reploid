#!/usr/bin/env node
/**
 * A stand-in for Doppler's share operator (tools/secret-shared/gpu/operator-gpu.js) in the harness tests: the same
 * command line, READY line and supervisor gate (WAIT s / GO s / STEP {...}), over a JSON-lines TCP protocol the fake
 * requester speaks. It computes nothing. It exists so the harness's stall, cancellation and settlement paths run with
 * real processes, real signals and the real ledger, without a model.
 */
import { createHash } from 'node:crypto';
import net from 'node:net';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { plan: { type: 'string' }, 'model-dir': { type: 'string' }, stage: { type: 'string' }, share: { type: 'string' },
  listen: { type: 'string' }, connect: { type: 'string' }, device: { type: 'string' }, threads: { type: 'string' }, gate: { type: 'boolean' } } });
const stage = Number(args.stage), share = Number(args.share);
const gate = readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const transcript = createHash('sha256');

const at = args.listen.lastIndexOf(':');
const server = net.createServer(socket => {
  let chain = Promise.resolve(), authorized = -1;
  readline.createInterface({ input: socket }).on('line', line => {
    const message = JSON.parse(line);
    chain = chain.then(async () => {
      if (message.op === 'hello') {
        if (message.token !== process.env.SS_TOKEN) throw Error('token');
        return { stage, share };
      }
      if (message.op === 'step') {
        if (authorized < message.step) {
          process.stdout.write(`WAIT ${message.step}\n`);
          const reply = await gate.next();
          if (reply.done || reply.value !== `GO ${message.step}`) throw Error('refused');
          authorized = message.step;
        }
        transcript.update(String(message.step));
        process.stdout.write(`STEP ${JSON.stringify({ step: message.step, rounds: 1, columns: message.columns, macs: 1, bytesOut: 8, transcript: transcript.copy().digest('hex') })}\n`);
        return { ok: true, step: message.step };
      }
      return { ok: true };
    }).then(reply => socket.write(JSON.stringify(reply) + '\n'), error => { socket.write(JSON.stringify({ error: String(error.message) }) + '\n'); socket.end(); });
  });
  socket.on('error', () => {});
});
server.listen(Number(args.listen.slice(at + 1)), args.listen.slice(0, at), () => process.stdout.write(`READY ${args.listen}\n`));
