/**
 * The requester's key holder: Doppler's JavaScript `pp.js bridge` (protocol `doppler-protected-bridge/v1`) as a child
 * Node process on this device. The secret key is generated (or loaded from its key-epoch store) inside that process and
 * never crosses this pipe; only evaluation keys, fresh ciphertexts and decrypted logits do. It holds no weights and
 * never talks to a peer.
 */
import { spawn } from 'node:child_process';
import { frameStream, ceilingHeaderInspector } from './frame-socket.js';
import { resolveDopplerProtected } from './doppler-tooling.js';

const BRIDGE_PROTOCOL = 'doppler-protected-bridge/v1';
const inspect = ceilingHeaderInspector({ opened: 0, key: 1 << 30, 'keys-done': 0, committed: 0, retired: 0, ciphertexts: 64 * (64 << 20),
  plaintext: 8 * 1024, refused: 0, closed: 0 });

export async function openDopplerKeyHolder({ doppler, profile, allowInsecureDevelopment = false, stateDir = null, keyTtlSeconds = 86400,
  timeoutMs = 10 * 60 * 1000 }) {
  const { pp } = resolveDopplerProtected(doppler);
  const args = [pp, 'bridge', '--profile', profile, '--key-ttl', `${keyTtlSeconds}s`];
  if (allowInsecureDevelopment) args.push('--allow-insecure-dev');
  if (stateDir) args.push('--state-dir', stateDir);
  const child = spawn(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2048); });
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  const link = frameStream({ readable: child.stdout, writable: child.stdin, inspect, destroy: () => child.kill('SIGKILL') });
  const request = (kind, fields = {}, blobs = []) => link.send({ header: { kind, protocol: BRIDGE_PROTOCOL, blobs: blobs.map(b => b.length), fields }, blobs });
  const expect = async kind => {
    let frame;
    try { frame = await link.receive({ timeoutMs }); } catch (error) {
      throw Object.assign(new Error(`Key holder stopped: ${error.message} ${stderr.trim()}`.trim()), { code: 'PROTECTED_KEY_HOLDER_FAILED' });
    }
    if (frame.header.kind !== kind && frame.header.kind !== 'refused') throw new Error(`Key holder answered ${frame.header.kind}, expected ${kind}`);
    return frame;
  };
  const opened = (await expect('opened')).header.fields;
  // One request at a time: the bridge answers in order.
  let queue = Promise.resolve();
  const serial = task => { const next = queue.then(task, task); queue = next.catch(() => {}); return next; };
  return Object.freeze({
    profileDigest: opened.profileDigest,
    epoch: Object.freeze({ id: opened.keyEpoch, expiresAt: opened.keyEpochExpires, keysDigest: opened.keysDigest || null, reused: opened.reused }),
    /** Generate evaluation keys one at a time; `onKey(blob)` forwards each before the next is made. Returns their digest. */
    generateKeys: onKey => serial(async () => {
      await request('keygen');
      for (;;) {
        const frame = await link.receive({ timeoutMs });
        if (frame.header.kind === 'keys-done') return frame.header.fields.keysDigest;
        if (frame.header.kind !== 'key') throw new Error(`Key holder answered ${frame.header.kind} during key generation`);
        await onKey(frame.blobs[0]);
      }
    }),
    commitKeys: keysDigest => serial(async () => { await request('commit-keys', { keysDigest }); await expect('committed'); }),
    /** Delete the stored epoch (secret key included): the next session starts a new key. */
    retireEpoch: () => serial(async () => { await request('retire-epoch'); await expect('retired'); }),
    encrypt: tokens => serial(async () => { await request('encrypt', { tokens }); return (await expect('ciphertexts')).blobs; }),
    /** Decrypt one result. Returns null, without decrypting, when the ciphertext does not have the pinned shape. */
    decrypt: blob => serial(async () => {
      await request('decrypt', {}, [blob]);
      const frame = await expect('plaintext');
      if (frame.header.kind === 'refused') return null;
      const bytes = frame.blobs[0];
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return Float64Array.from({ length: bytes.length / 8 }, (_, i) => view.getFloat64(8 * i, true));
    }),
    close: () => serial(async () => {
      let stats = null;
      try { await request('close'); stats = (await expect('closed')).header.fields; } catch { /* already gone */ }
      link.close();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
      child.kill('SIGKILL');
      return stats;
    })
  });
}
