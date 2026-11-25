/**
 * The evaluator engine port backed by Doppler's CPU evaluator (`privacy-protected evaluator`, Go and Lattigo). It
 * computes on ciphertext with public weights and public evaluation keys; it never has a secret key. A GPU evaluator
 * replaces this file by implementing the same `describe()` and `open(schedule)` port.
 */
import { spawn, execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { connectFrameSocket, goHeaderInspector } from './frame-socket.js';

const run = promisify(execFile);
const inspect = goHeaderInspector({ manifest: 0, ready: 0, result: 8 * (32 << 20), 'decrypt-request': 64 << 20 });

export async function startGoEvaluator({ binary, model, stateDir = null, misbehave = '', maxLanes = 8, log = () => {}, timeoutMs = 30 * 60 * 1000 }) {
  const readyFile = path.join(os.tmpdir(), `protected-engine-${process.pid}-${Date.now()}.addr`);
  // --exit-with-stdin: the engine ends with this process, even when this process is killed.
  const args = ['evaluator', '--model', model, '--sessions', '0', '--listen', '127.0.0.1:0', '--ready-file', readyFile, '--max-lanes', String(maxLanes),
    '--exit-with-stdin'];
  if (stateDir) args.push('--state-dir', stateDir);
  if (misbehave) args.push('--misbehave', misbehave);
  const child = spawn(binary, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => log(String(chunk).trim()));
  let address = null;
  for (const deadline = Date.now() + 60000; !address; await new Promise(resolve => setTimeout(resolve, 50))) {
    address = await readFile(readyFile, 'utf8').catch(() => null);
    if (child.exitCode !== null) throw new Error('The evaluator engine exited during start');
    if (Date.now() > deadline) { child.kill('SIGKILL'); throw new Error('The evaluator engine did not start'); }
  }
  await rm(readyFile, { force: true });
  let lock = Promise.resolve();
  return Object.freeze({
    async describe(profile) {
      const { stdout } = await run(binary, ['evaluator', '--describe', '--profile', profile, '--model', model, '--max-lanes', String(maxLanes)]);
      return JSON.parse(stdout);
    },
    /** One engine session per protected session, one at a time. */
    async open({ profile, modelIdentity, lanes, promptTokens, generatedTokens, keyEpoch }) {
      let release;
      const previous = lock;
      lock = new Promise(resolve => { release = resolve; });
      await previous;
      let link;
      try {
        link = await connectFrameSocket(address, { inspect });
      } catch (error) { release(); throw error; }
      const session = `engine-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const send = (kind, fields = {}, blobs = [], seq = 0) => link.send({ header: { kind, protocol: 'doppler-protected-ckks-tiny/v0-research',
        session, seq, blobs: blobs.map(blob => blob.length), fields }, blobs });
      const expect = async kind => {
        const frame = await link.receive({ timeoutMs });
        if (frame.header.kind !== kind) throw new Error(`Engine answered ${frame.header.kind}, expected ${kind}`);
        return frame;
      };
      try {
        await send('hello', { profile, model: modelIdentity, promptTokens, generatedTokens, keyEpoch: keyEpoch.id, keyEpochExpires: keyEpoch.expiresAt, lanes });
        const manifest = (await expect('manifest')).header.fields;
        return {
          manifest, keyCount: 1 + manifest.rotations.length,
          sendKey: blob => send('key', {}, [blob]),
          keysHeld: () => send('keys-held'),
          ready: async () => (await expect('ready')).header.fields.keysDigest,
          async step({ phase, seq, blobs }) {
            await send(phase, {}, blobs, seq);
            const frame = await expect('result');
            if (frame.header.seq !== seq || frame.blobs.length !== lanes) throw new Error('Engine result is not for this step');
            return frame.blobs;
          },
          async close() { await send('bye').catch(() => {}); link.close(); release(); }
        };
      } catch (error) { link.close(); release(); throw error; }
    },
    stop() { child.kill('SIGTERM'); }
  });
}
