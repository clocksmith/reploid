// @vitest-environment node
import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeArtifactCache, createNativeModelFiles } from '../../server/native-model-files.js';
const roots = [], hosts = [];
afterEach(async () => { await Promise.allSettled(hosts.splice(0).map(host => host.close())); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function folder() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-native-files-')); roots.push(root); return root; }
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1-index].readyState === 'open') pair[1-index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1-index].close()); } }));
  return pair;
}
async function fixture(count = 2) {
  const stores = [], callbacks = [], owners = [], directories = [], cacheDirectories = [], writes = [];
  const chunks = [Buffer.from([1,2,3,4]), Buffer.from([5,6,7,8])], whole = Buffer.concat(chunks);
  const manifest = Buffer.from(JSON.stringify({ modelId: 'native-fixture', hashAlgorithm: 'sha256', shards: [{ filename: 'weights.bin', size: 8, hash: hash(whole) }] }));
  const index = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + hash(manifest), maxPieceBytes: 4,
    files: [{ path: 'weights.bin', size: 8, pieces: chunks.map((bytes, i) => ({ offset: i * 4, size: 4, identity: 'sha256:' + hash(bytes) })) }] }));
  const model = { id: 'native-fixture', identity: 'sha256:' + hash(manifest), source: { files: [
    { path: 'manifest.json', role: 'model-manifest', sizeBytes: manifest.length, hashAlgorithm: 'sha256', hash: hash(manifest) },
    { path: 'pieces.json', role: 'model-piece-index', sizeBytes: index.length, hashAlgorithm: 'sha256', hash: hash(index) }
  ] } };
  const network = { intercept: () => {} };
  for (let i = 0; i < count; i++) {
    stores.push(new Map()); const directory = await folder(), cacheDirectory = await folder(); directories.push(directory); cacheDirectories.push(cacheDirectory);
    await fs.writeFile(path.join(directory, 'manifest.json'), manifest); await fs.writeFile(path.join(directory, 'pieces.json'), index);
    if (i > 0) await fs.writeFile(path.join(directory, 'weights.bin'), whole);
    const transport = { _getPeerId: () => String(i), getConnectedPeers: () => stores.map((_, id) => ({ id: String(id) })).filter(p => p.id !== String(i)),
      onMessage: (type, fn) => stores[i].set(type, fn), onDataChannel: (_, fn) => { callbacks[i] = fn; return () => { if (network.failClose) throw new Error('custody close failed'); }; },
      sendToPeer(peer, type, payload) { const message = structuredClone(payload); writes.push({ from: i, peer, type, message }); network.intercept({ from: i, peer, type, message }); queueMicrotask(() => stores[Number(peer)].get(type)?.(String(i), message)); return true; },
      broadcast(type, payload) { for (const peer of this.getConnectedPeers()) this.sendToPeer(peer.id, type, payload); },
      openDataChannel(peer) { const [left,right] = channels(); callbacks[Number(peer)](String(i), right); return left; } };
    const host = await createNativeModelFiles({ transport, modelDirectory: directory, cacheDirectory }); owners.push(host); hosts.push(host);
  }
  return { owners, model, chunks, directories, cacheDirectories, writes, network,
    async share() { for (const host of owners.slice(1)) await host.share(model, true); await new Promise(resolve => setTimeout(resolve, 10)); } };
}
it('persists only requested verified pieces and reopens them without a supplier', async () => {
  const f = await fixture(); await f.share(); const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    expect(new Uint8Array(await source.storage.loadShardRange(0, 1, 2))).toEqual(new Uint8Array([2,3]));
    expect(source.getReceipt().verifiedBytes).toBe(4);
    const files = await fs.readdir(f.cacheDirectories[0]);
    expect(files).toContain('sha256-' + hash(f.chunks[0])); expect(files).not.toContain('sha256-' + hash(f.chunks[1]));
    f.owners[1].stopSupply();
    const reopened = await f.owners[0].preparePartitionSource(f.model);
    try { expect(new Uint8Array(await reopened.storage.loadShardRange(0, 0, 4))).toEqual(new Uint8Array(f.chunks[0])); }
    finally { await reopened.storage.close(); }
  } finally { await source.storage.close(); }
});
it('binds Capsule artifact reads to catalog identities and complete authenticated piece ranges', async () => {
  const f = await fixture(); await f.share();
  const source = await f.owners[0].preparePartitionSource(f.model);
  const metadata = f.model.source.files[0], artifact = { ...metadata, hash: 'sha256:' + metadata.hash };
  const weights = source.manifest.shards[0];
  const shard = { path: weights.filename, hash: 'sha256:' + weights.hash, sizeBytes: weights.size };
  try {
    expect(await source.artifactStore.readArtifact(artifact)).toEqual(new Uint8Array(await fs.readFile(path.join(f.directories[0], metadata.path))));
    await expect(source.artifactStore.readArtifact({ ...artifact, hash: 'sha256:' + '0'.repeat(64) })).rejects.toThrow('pinned catalog');
    await expect(source.artifactStore.readArtifact(shard)).rejects.toThrow('piece ranges');
    await expect(source.artifactStore.readArtifactRange(shard, 1, 2)).rejects.toThrow('complete pinned piece');
    expect(await source.artifactStore.readArtifactRange(shard, 0, 4)).toEqual(new Uint8Array(f.chunks[0]));
    expect(await fs.readdir(f.cacheDirectories[0])).not.toContain('sha256-' + hash(f.chunks[1]));
    const controller = new AbortController(); controller.abort(new Error('Stopped'));
    await expect(source.artifactStore.readArtifactRange(shard, 4, 4, { signal: controller.signal })).rejects.toThrow();
  } finally { await source.storage.close(); }
  await expect(source.artifactStore.readArtifact(artifact)).rejects.toThrow('closed');
});
it('requires separate supply approval and revokes inventory without closing compute sources', async () => {
  const f = await fixture(); await expect(f.owners[1].share(f.model, false)).rejects.toThrow('separately');
  await f.share(); expect(f.owners[1].getState().sharing).toBe(true); f.owners[1].stopSupply();
  await new Promise(resolve => setTimeout(resolve, 10)); expect(f.owners[1].getState().sharing).toBe(false);
  const source = await f.owners[1].preparePartitionSource(f.model);
  try { expect(new Uint8Array(await source.storage.loadShardRange(0,0,4))).toEqual(new Uint8Array(f.chunks[0])); }
  finally { await source.storage.close(); }
});
it('rejects a corrupt supplier and uses another already authorized supplier', async () => {
  const f = await fixture(3); await f.share();
  await fs.writeFile(path.join(f.cacheDirectories[1], 'sha256-' + hash(f.chunks[0])), Buffer.from([9,9,9,9]));
  const source = await f.owners[0].preparePartitionSource(f.model);
  try { expect(new Uint8Array(await source.storage.loadShardRange(0,0,4))).toEqual(new Uint8Array(f.chunks[0]));
    expect(f.writes.filter(row => row.type === 'reploid:custody-request' && row.message.artifact).map(row => row.peer)).toEqual(['1','2']); }
  finally { await source.storage.close(); }
});
it('rejects expanded signed-custody grant metadata before committing bytes', async () => {
  const f = await fixture(); await f.share();
  f.network.intercept = ({ type, message }) => { if (type === 'reploid:custody-response' && message.authorization) message.authorization.expiresAt += 10000000; };
  const source = await f.owners[0].preparePartitionSource(f.model);
  try { await expect(source.storage.loadShardRange(0,0,4)).rejects.toThrow('No eligible source');
    expect(await fs.readdir(f.cacheDirectories[0])).not.toContain('sha256-' + hash(f.chunks[0])); }
  finally { await source.storage.close(); }
});
it('cancels an in-flight acquisition without committing its incomplete piece', async () => {
  const f = await fixture(); await f.share(); const controller = new AbortController();
  f.network.intercept = ({ type, message }) => { if (type === 'reploid:custody-response' && message.authorization) controller.abort(new Error('Contribution stopped')); };
  const source = await f.owners[0].preparePartitionSource(f.model, { signal: controller.signal });
  try { await expect(source.storage.loadShardRange(0,0,4)).rejects.toThrow();
    expect(await fs.readdir(f.cacheDirectories[0])).not.toContain('sha256-' + hash(f.chunks[0])); }
  finally { await source.storage.close(); }
});
it('enforces cache budget, rejects symlinks and leaves no partial committed file on cancellation', async () => {
  const directory = await folder(), cache = await createNativeArtifactCache({ directory, maxBytes: 4 });
  const bytes = new Uint8Array([1,2,3,4]), file = { sizeBytes: 4, hash: hash(bytes), hashAlgorithm: 'sha256' };
  await cache.put(file, bytes); expect(await cache.get(file)).toEqual(bytes);
  const other = new Uint8Array([2,3,4,5]); await expect(cache.put({ ...file, hash: hash(other) }, other)).rejects.toThrow('budget');
  await fs.unlink(path.join(directory, 'sha256-' + file.hash)); await fs.symlink('/etc/passwd', path.join(directory, 'sha256-' + file.hash));
  await expect(cache.get(file)).rejects.toThrow();
});

it('quarantines a corrupted retained piece and reacquires verified bytes from an authorized supplier', async () => {
  const f = await fixture(); await f.share();
  await fs.writeFile(path.join(f.cacheDirectories[0], 'sha256-' + hash(f.chunks[0])), new Uint8Array([9,9,9,9]));
  const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    expect(new Uint8Array(await source.storage.loadShardRange(0,0,4))).toEqual(new Uint8Array(f.chunks[0]));
    expect(f.owners[0].getState().cache.quarantined).toHaveLength(1);
    expect(await fs.readFile(path.join(f.cacheDirectories[0], 'sha256-' + hash(f.chunks[0])))).toEqual(f.chunks[0]);
  } finally { await source.storage.close(); }
});
it('attempts cache settlement even when custody close rejects and retains both failures', async () => {
  const f = await fixture();
  const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('cache commit failed'));
  try { await expect(f.owners[0].preparePartitionSource(f.model)).rejects.toThrow('cache commit failed'); }
  finally { rename.mockRestore(); }
  f.network.failClose = true;
  const failure = await f.owners[0].close().catch(error => error);
  expect(failure).toBeInstanceOf(AggregateError);
  expect(failure.errors.map(error => error.message).sort()).toEqual(['cache commit failed', 'custody close failed']);
});
it('offers newly acquired pieces only while their model has approved supply', async () => {
  const f = await fixture(3);
  await fs.unlink(path.join(f.directories[2], 'weights.bin'));
  await f.owners[1].share(f.model, true);
  await f.owners[0].share(f.model, true); // Initially only metadata is present.
  const source = await f.owners[0].preparePartitionSource(f.model);
  await source.storage.loadShardRange(0, 0, 4);
  f.owners[1].stopSupply();
  await new Promise(resolve => setTimeout(resolve, 10));
  const reader = await f.owners[2].preparePartitionSource(f.model);
  try {
    expect(new Uint8Array(await reader.storage.loadShardRange(0, 0, 4))).toEqual(new Uint8Array(f.chunks[0]));
    expect(f.writes.some(row => row.from === 2 && row.peer === '0' && row.type === 'reploid:custody-request')).toBe(true);
    f.owners[0].stopSupply();
    await f.owners[1].share(f.model, true);
    await source.storage.loadShardRange(0, 4, 4);
    expect(f.owners[0].getState().sharing).toBe(false);
  } finally { await source.storage.close(); await reader.storage.close(); }
});

it('maps signed Rig paths to exact manifest-relative native piece sources', async () => {
  const f = await fixture(); await f.share();
  const metadata = f.model.source.files[0];
  const manifestArtifact = { artifactId: 'manifest', role: 'manifest', path: 'artifacts/model/manifest.json',
    hash: 'sha256:' + metadata.hash, sizeBytes: metadata.sizeBytes };
  const whole = Buffer.concat(f.chunks);
  const artifact = { artifactId: 'weights', role: 'weight-shard', path: 'artifacts/model/weights.bin',
    hash: 'sha256:' + hash(whole), sizeBytes: whole.length };
  f.model.capsule = { program: { manifestArtifactId: 'manifest' }, artifacts: [manifestArtifact, artifact] };
  const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    expect(hash(await source.artifactStore.readArtifact(manifestArtifact))).toBe(metadata.hash);
    expect(await source.artifactStore.readArtifactRange(artifact, 0, 4)).toEqual(new Uint8Array(f.chunks[0]));
    await expect(source.artifactStore.readArtifact(artifact)).rejects.toThrow('piece ranges');
    for (const changed of [{ ...artifact, path: 'other/weights.bin' }, { ...artifact, hash: 'sha256:' + '0'.repeat(64) },
      { ...artifact, path: 'artifacts/model/../weights.bin' }]) {
      f.model.capsule.artifacts[1] = changed;
      await expect(source.artifactStore.readArtifactRange(changed, 0, 4)).rejects.toThrow('pinned catalog');
      f.model.capsule.artifacts[1] = artifact;
    }
    await expect(source.artifactStore.readArtifactRange(artifact, 1, 2)).rejects.toThrow('complete pinned piece');
  } finally { await source.storage.close(); }
});
