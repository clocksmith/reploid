// @vitest-environment node
import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeArtifactCache, createNativeModelFiles } from '../../server/native-model-files.js';
import { CUSTODY_CERTIFICATE_LIFETIME_MS, checkCustodyKeyCertificate, createCustodyKeyCertifier } from '../../packages/reploid/src/artifacts/custody-certificate.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
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
async function fixture(count = 2, { certify = null, hostOptions = () => ({}) } = {}) {
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
    const host = await createNativeModelFiles({ transport, modelDirectory: directory, cacheDirectory, ...(certify ? { certifyCustodyKey: certify(i) } : {}), ...hostOptions(model) });
    owners.push(host); hosts.push(host);
  }
  return { owners, model, chunks, directories, cacheDirectories, writes, network,
    async share() { for (const host of owners.slice(1)) await host.share(model, true); await new Promise(resolve => setTimeout(resolve, 10)); } };
}
it('persists only requested verified pieces and reopens them without a supplier', async () => {
  const f = await fixture(); await f.share(); const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    expect(new Uint8Array(await source.storage.loadShardRange(0, 1, 2))).toEqual(new Uint8Array([2,3]));
    expect(source.getReceipt().verifiedBytes).toBe(4);
    const complete = f.owners[0].getState();
    expect(complete.receipts.length).toBeGreaterThan(0);
    const summary = f.owners[0].getState({ includeReceipts: false });
    expect(summary).not.toHaveProperty('receipts');
    expect(summary).toEqual({ ...complete, receipts: undefined });
    expect(summary.receiptCount).toBe(complete.receipts.length);
    // Polling summaries must not discard the retained signed transfer evidence.
    expect(f.owners[0].getState().receipts).toEqual(complete.receipts);
    const files = await fs.readdir(f.cacheDirectories[0]);
    expect(files).toContain('sha256-' + hash(f.chunks[0])); expect(files).not.toContain('sha256-' + hash(f.chunks[1]));
    f.owners[1].stopSupply();
    const reopened = await f.owners[0].preparePartitionSource(f.model);
    try { expect(new Uint8Array(await reopened.storage.loadShardRange(0, 0, 4))).toEqual(new Uint8Array(f.chunks[0])); }
    finally { await reopened.storage.close(); }
  } finally { await source.storage.close(); }
});
it('certifies the custody key its grants carry only when a participant identity certifier is supplied', async () => {
  const identities = [await createSigningIdentity({ algorithm: 'Ed25519' }), await createSigningIdentity({ algorithm: 'ECDSA' })];
  const issued = [];
  const f = await fixture(2, { certify: i => createCustodyKeyCertifier({ identity: identities[i], onIssue: c => issued.push(c) }).certify });
  const certificates = await Promise.all(f.owners.map(host => host.custodyCertificate()));
  for (const [i, certificate] of certificates.entries()) {
    expect(certificate).toMatchObject({ participantId: identities[i].peerId, custodyPeerId: String(i) });
    expect(await checkCustodyKeyCertificate(certificate, { publicJwk: identities[i].publicJwk, atMs: Date.now(),
      maxLifetimeMs: CUSTODY_CERTIFICATE_LIFETIME_MS, maxClockSkewMs: 0 })).toEqual([]);
  }
  expect(await f.owners[0].custodyCertificate()).toBe(certificates[0]); expect(issued).toEqual(certificates);
  await f.share(); const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    await source.storage.loadShardRange(0, 0, 4);
    // The requester identity custody requests carry is exactly the certified key and custody peer id.
    const requesters = f.writes.filter(row => row.type === 'reploid:custody-request' && row.message.requester).map(row => row.message.requester);
    expect(requesters.length).toBeGreaterThan(0);
    for (const requester of requesters) expect(requester).toEqual({ peerId: certificates[0].custodyPeerId, publicKey: certificates[0].custodyPublicKey });
  } finally { await source.storage.close(); }
  expect(await (await fixture(1)).owners[0].custodyCertificate()).toBeNull();
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
  await fs.writeFile(path.join(f.directories[1], 'weights.bin'), Buffer.from([9,9,9,9,5,6,7,8]));
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

it('loads nested signed metadata from its pinned native bundle without treating it as a model filename', async () => {
  const f = await fixture(1), bytes = Buffer.from('signed shader metadata');
  const metadata = { path: 'artifacts/program/host/entry.js', role: 'host-program',
    hashAlgorithm: 'sha256', hash: hash(bytes), sizeBytes: bytes.length,
    url: '/config/model-artifacts/' + hash(bytes) + '.js' };
  const artifact = { artifactId: 'host-entry', role: metadata.role, path: metadata.path,
    hash: 'sha256:' + metadata.hash, sizeBytes: metadata.sizeBytes };
  const manifest = f.model.source.files[0];
  f.model.source.files.push(metadata);
  f.model.capsule = { program: { manifestArtifactId: 'manifest' }, artifacts: [
    { artifactId: 'manifest', role: 'manifest', path: 'artifacts/model/manifest.json', hash: f.model.identity, sizeBytes: manifest.sizeBytes }, artifact] };
  const original = fs.readFile.bind(fs);
  const read = vi.spyOn(fs, 'readFile').mockImplementation((file, ...args) =>
    String(file instanceof URL ? file.pathname : file).endsWith(metadata.url) ? Promise.resolve(bytes) : original(file, ...args));
  const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    await f.owners[0].share(f.model, true);
    expect(f.writes.filter(row => row.type === 'reploid:custody-offer').flatMap(row => row.message.artifacts)
      .some(file => file.path === metadata.path)).toBe(false);
    expect(await source.artifactStore.readArtifact(artifact)).toEqual(new Uint8Array(bytes));
    expect(f.writes.some(row => row.type === 'reploid:custody-request')).toBe(false);
  } finally { await source.storage.close(); read.mockRestore(); }
});

it('verifies existing approved weight pieces without making a second disk copy', async () => {
  const f = await fixture();
  const source = await f.owners[1].preparePartitionSource(f.model);
  try {
    expect(new Uint8Array(await source.storage.loadShardRange(0, 0, 4))).toEqual(new Uint8Array(f.chunks[0]));
    expect(await fs.readdir(f.cacheDirectories[1])).not.toContain('sha256-' + hash(f.chunks[0]));
    expect(source.getReceipt().custody.reusedBytes).toBe(4);
  } finally { await source.storage.close(); }
});
it('shares approved local files without duplicating their weights into the artifact cache', async () => {
  const f = await fixture(); await f.share();
  expect(await fs.readdir(f.cacheDirectories[1])).not.toContain('sha256-' + hash(f.chunks[0]));
  const source = await f.owners[0].preparePartitionSource(f.model);
  try { expect(new Uint8Array(await source.storage.loadShardRange(0, 0, 4))).toEqual(new Uint8Array(f.chunks[0])); }
  finally { await source.storage.close(); }
});

it('shares verified adapter bytes separately from compute and reuses them after the supplier leaves', async () => {
  const f = await fixture();
  const bytes = new Uint8Array([11, 17, 23]);
  const artifact = { artifactId: 'adapter', role: 'adapter', path: 'adapter.safetensors',
    sizeBytes: bytes.length, hash: 'sha256:' + hash(bytes), url: 'https://invalid.example/adapter' };
  f.model.adapters = [{ identity: 'sha256:' + 'b'.repeat(64), baseModelIdentity: f.model.identity, artifact }];
  await fs.writeFile(path.join(f.directories[1], artifact.path), bytes);
  await f.share();
  expect(await f.owners[0].acquireAdapter(artifact, { signal: new AbortController().signal })).toEqual(bytes);
  f.owners[1].stopSupply();
  expect(await f.owners[0].acquireAdapter(artifact, { signal: new AbortController().signal })).toEqual(bytes);
  const cancelled = new AbortController(); cancelled.abort(new Error('stopped'));
  await expect(f.owners[0].acquireAdapter(artifact, { signal: cancelled.signal })).rejects.toThrow('stopped');
});
it('fills a whole-model directory from an authorized peer and drops the duplicate cached pieces', async () => {
  const f = await fixture();
  await fs.rm(path.join(f.directories[0], 'manifest.json')); await fs.rm(path.join(f.directories[0], 'pieces.json'));
  await f.share();
  const events = [];
  const result = await f.owners[0].fillWholeModel(f.model, { onProgress: event => events.push(event.phase) });
  expect(result).toMatchObject({ filled: true, fetchedPieces: 2, completedFiles: 2 });
  expect(await fs.readFile(path.join(f.directories[0], 'weights.bin'))).toEqual(Buffer.concat(f.chunks));
  expect(hash(await fs.readFile(path.join(f.directories[0], 'manifest.json')))).toBe(f.model.identity.slice(7));
  const cached = await fs.readdir(f.cacheDirectories[0]);
  for (const chunk of f.chunks) expect(cached).not.toContain('sha256-' + hash(chunk));
  expect(events.at(-1)).toBe('complete');
  // A complete directory is left alone and needs no supplier.
  f.owners[1].stopSupply();
  expect(await f.owners[0].fillWholeModel(f.model)).toEqual({ complete: true, filled: false });
});
function fakeOrigin(bytesFor, { corrupt = false } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    const name = url.split('/').at(-1), bytes = bytesFor(name); requests.push({ url, range: init.headers.range ?? null, credentials: init.credentials });
    if (!bytes) return new Response('missing', { status: 404 });
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(init.headers.range || '') || [];
    const body = start === undefined ? Buffer.from(bytes) : Buffer.from(bytes.subarray(Number(start), Number(end) + 1));
    if (corrupt && start !== undefined && Number(start) > 0) body[0] ^= 0xff;
    return new Response(body, start === undefined ? { status: 200 } : { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${bytes.length}` } });
  };
  return { fetch, requests };
}
const originTable = model => ({ schema: 'reploid.native-model-origins/v1', origins: { [model.id]: { modelIdentity: model.identity, kind: 'huggingface',
  repoId: 'owner/repo', revision: 'a'.repeat(40), path: 'models/' + model.id } } });
async function soloHost(f, origin) {
  const directory = await folder(), cacheDirectory = await folder();
  // Bundled pinned metadata (the delivery's served config) stands in as local files here.
  for (const name of ['manifest.json', 'pieces.json']) await fs.copyFile(path.join(f.directories[0], name), path.join(directory, name));
  const transport = { _getPeerId: () => 'solo', getConnectedPeers: () => [], onMessage() {}, onDataChannel: () => () => {}, sendToPeer: () => true, broadcast() {} };
  const host = await createNativeModelFiles({ transport, modelDirectory: directory, cacheDirectory, modelOrigins: originTable(f.model),
    originFetch: origin.fetch, peerGraceMs: 20 });
  hosts.push(host); return { host, directory };
}
it('fills from the pinned origin when no peer is online, by verified ranges and without credentials', async () => {
  const f = await fixture(1), whole = Buffer.concat(f.chunks), origin = fakeOrigin(name => name === 'weights.bin' ? whole : null);
  const { host, directory } = await soloHost(f, origin), events = [];
  const result = await host.fillWholeModel(f.model, { onProgress: event => events.push(event) });
  expect(await fs.readFile(path.join(directory, 'weights.bin'))).toEqual(whole);
  expect(result.sources).toEqual({ 'pinned-origin:huggingface': { pieces: 2, bytes: 8 } });
  // Per-supplier attribution names the pinned repository and revision, never an address.
  expect(result.suppliers).toEqual({ [`origin:owner/repo@${'a'.repeat(40)}`]: { pieces: 2, bytes: 8 } });
  expect(events.filter(event => event.phase === 'piece').map(event => event.supplier)).toEqual(Array(2).fill(`origin:owner/repo@${'a'.repeat(40)}`));
  expect(events.at(-1)).toMatchObject({ phase: 'complete', suppliers: result.suppliers });
  expect(events.find(event => event.phase === 'source')).toMatchObject({ source: 'pinned-origin:huggingface',
    origin: `huggingface:owner/repo@${'a'.repeat(40)}/models/native-fixture` });
  expect(origin.requests.map(request => [request.url, request.range, request.credentials])).toEqual([
    [`https://huggingface.co/owner/repo/resolve/${'a'.repeat(40)}/models/native-fixture/weights.bin`, 'bytes=0-3', 'omit'],
    [`https://huggingface.co/owner/repo/resolve/${'a'.repeat(40)}/models/native-fixture/weights.bin`, 'bytes=4-7', 'omit']]);
  // The manifest is the bundled pinned copy, never the origin's.
  expect(origin.requests.some(request => request.url.endsWith('manifest.json'))).toBe(false);
});
it('rejects a corrupted origin range and leaves no model file', async () => {
  const f = await fixture(1), origin = fakeOrigin(name => name === 'weights.bin' ? Buffer.concat(f.chunks) : null, { corrupt: true });
  const { host, directory } = await soloHost(f, origin);
  await expect(host.fillWholeModel(f.model)).rejects.toMatchObject({ code: 'WHOLE_MODEL_PIECE_REJECTED' });
  const names = await fs.readdir(directory);
  expect(names).not.toContain('weights.bin');
});
it('prefers authorized peers over the pinned origin', async () => {
  const origin = fakeOrigin(() => { throw new Error('origin must not be asked'); });
  const f = await fixture(2, { hostOptions: model => ({ modelOrigins: originTable(model), originFetch: origin.fetch }) });
  await fs.rm(path.join(f.directories[0], 'manifest.json'));
  await f.share();
  const result = await f.owners[0].fillWholeModel(f.model);
  expect(result.sources).toEqual({ 'authorized-custody-peers': { pieces: 2, bytes: 8 } });
  // The supplying peer is named by its room participant id.
  expect(result.suppliers).toEqual({ 1: { pieces: 2, bytes: 8 } });
  expect(origin.requests).toEqual([]);
});
it('attributes partition pieces to the custody peer that delivered them', async () => {
  const f = await fixture(); await f.share(); const source = await f.owners[0].preparePartitionSource(f.model);
  try {
    await source.storage.loadShardRange(0, 0, 8);
    expect(source.getReceipt().custody.suppliers).toEqual({ 1: { pieces: 2, bytes: 8 } });
  } finally { await source.storage.close(); }
});
it('ships origins only for catalog models whose identity the pin names', async () => {
  const { resolvePinnedOrigin } = await import('../../server/native-model-origin.js');
  const table = JSON.parse(await fs.readFile(new URL('../../server/native-model-origins.json', import.meta.url), 'utf8'));
  const catalog = JSON.parse(await fs.readFile(new URL('../../shared/config/chat-models.json', import.meta.url), 'utf8'));
  const models = new Map((Array.isArray(catalog) ? catalog : catalog.models).map(model => [model.id, model]));
  expect(Object.keys(table.origins).sort()).toEqual(['qwen-3-5-0-8b-q4k-ehaf16', 'qwen-3-5-2b-q4k-ehaf16']);
  for (const id of Object.keys(table.origins)) {
    const origin = resolvePinnedOrigin(models.get(id), table);
    expect(origin.url('tokenizer.json')).toBe(`https://huggingface.co/${table.origins[id].repoId}/resolve/${table.origins[id].revision}/models/${id}/tokenizer.json`);
    expect(origin.supplier).toBe(`origin:clocksmith/rdrr@${table.origins[id].revision}`);
  }
  expect(resolvePinnedOrigin(models.get('qwen-3-5-0-8b-q4k-ehaf16'), table).label)
    .toBe('huggingface:clocksmith/rdrr@ea7b211b72c4d43687fa72802dee7aba74eca293/models/qwen-3-5-0-8b-q4k-ehaf16');
  // The 35B is not published at any origin; it has no pin.
  expect(resolvePinnedOrigin(models.get('qwen-3-6-35b-a3b-text-source-q4_0-af32'), table)).toBeNull();
  // A pin never serves another identity of the same model id.
  expect(() => resolvePinnedOrigin({ ...models.get('qwen-3-5-0-8b-q4k-ehaf16'), identity: 'sha256:' + '0'.repeat(64) }, table)).toThrow('another model identity');
});
