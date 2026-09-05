/** Browser contract test with synthetic bytes and internally operated suppliers. */
import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

let server;
let origin;
test.beforeAll(async () => {
  const root = path.resolve('.');
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><title>Peer custody contract</title>');
        return;
      }
      const relative = pathname.startsWith('/core/') ? `self${pathname}` : pathname.slice(1);
      const file = path.resolve(root, relative);
      if (![path.join(root, 'self') + path.sep, path.join(root, 'tests/fixtures') + path.sep].some((prefix) => file.startsWith(prefix))) {
        response.writeHead(403).end();
        return;
      }
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
});

test('browser crypto reconstructs dependencies and the Verification Worker accepts the source', async ({ page }, testInfo) => {
  await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const { createCustodyFixture } = await import('/tests/fixtures/peer-pack-custody.js');
    const { createPeerPackArtifactStore } = await import('/self/pool/peer-pack-custody.js');
    const { sha256Hex } = await import('/self/pool/inference-receipt.js');
    const { hashDopplerEvidence } = await import('/self/pool/executable-pack.js');
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7]);
    const digest = (value) => `sha256:${value.repeat(64)}`;
    const artifacts = [{ artifactId: 'weights', role: 'weight-shard', path: 'weights.bin', sizeBytes: bytes.length, hash: await sha256Hex(bytes) }];
    const binding = { schema: 'doppler.pack/v3', packId: 'browser-fixture', semanticRoot: digest('a'), envelopeDigest: digest('b'),
      artifactClosureDigest: await hashDopplerEvidence(artifacts), artifacts, requiredOperation: 'encodeSequence', acceptedTargetPlanDigests: [digest('c')] };
    const fixture = await createCustodyFixture(binding, new Map([['weights', bytes]]));
    const store = await createPeerPackArtifactStore(fixture.options);
    let output;
    let receipt;
    try {
      output = Array.from(await store.readArtifact(artifacts[0]));
      receipt = store.getReceipt();
    } finally { store.close(); }
    const snapshot = {};
    for (const file of [
      'peer-pack-custody.js', 'peer-pack-data-channel.js', 'executable-pack.js', 'pack-operation-adapters.js', 'pack-operation.js',
      'evidence-network.js', 'evidence-record-contract.js', 'evidence-normalization.js', 'evidence-records.js',
      'evidence-verification.js', 'evidence-admission.js', 'evidence-queries.js', 'research-cycle.js', 'provider-client.js'
    ]) {
      snapshot[`/pool/${file}`] = await (await fetch(`/self/pool/${file}`)).text();
    }
    const worker = new Worker('/core/verification-worker.js');
    const verification = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = (event) => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
    return { output, receipt, verification };
  });
  expect(result.output).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(result.receipt.completed).toHaveLength(1);
  expect(result.receipt.attempts.filter((item) => item.status === 'rejected')).toHaveLength(4);
  expect(result.verification.passed, JSON.stringify(result.verification.errors)).toBe(true);
  await testInfo.attach('custody-browser-contract', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});

test('browser evidence facade preserves signing, reviewed admission, and revocation', async ({ page }, testInfo) => {
  await page.route('**/*', (route) => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  const result = await page.evaluate(async () => {
    const api = await import('/self/pool/evidence-network.js');
    const admission = await import('/self/pool/evidence-admission.js');
    const { createSigningKeyPair } = await import('/self/pool/inference-receipt.js');
    const { buildLaunchProviderModel } = await import('/self/pool/model-contract.js');
    const identity = async (kind) => {
      const keyPair = await createSigningKeyPair();
      return {
        resolve: async () => ({ kind, roleId: kind + '-role', userId: kind + '-user', deviceId: kind + '-device', identityRootId: kind + '-root' }),
        getSigningKeyPair: async () => keyPair
      };
    };
    const requester = await identity('requester');
    const reviewer = await identity('reviewer');
    const source = await api.createSignedResearchSubmission({
      identity: requester, roomId: 'browser-contract', sequence: 'MKTA',
      intent: { kind: 'question', text: 'Contract fixture; no scientific conclusion.' },
      consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: false },
      modelContract: buildLaunchProviderModel(), policyId: 'fastest_receipt'
    });
    const review = await api.createSignedHumanClaim({
      identity: reviewer, roomId: source.roomId, targetHash: source.recordHash,
      claimKind: 'review_decision', relation: 'reviews', text: 'Accept this contract fixture for reuse.', confidence: 1, decision: 'accepted'
    });
    const revocation = await api.createSignedResearchRevocation({
      identity: requester, roomId: source.roomId, targetHash: source.recordHash, reason: 'Withdraw the contract fixture.'
    });
    const records = [source, review];
    return {
      sourceHash: source.recordHash,
      verified: await Promise.all([...records, revocation].map((record) => api.verifyResearchRecord(record))),
      links: api.validateResearchRecordLinks(revocation, records),
      tampered: await api.verifyResearchRecord({ ...source, policyId: 'changed' }),
      beforeReview: api.projectAcceptedResearchMemory([source]),
      admitted: api.projectAcceptedResearchMemory(records),
      revoked: admission.projectAcceptedResearchMemory([...records, revocation]),
      sameAdmissionOwner: api.projectAcceptedResearchMemory === admission.projectAcceptedResearchMemory
    };
  });
  for (const verification of result.verified) expect(verification, JSON.stringify(verification)).toMatchObject({ ok: true });
  expect(result.links, JSON.stringify(result.links)).toMatchObject({ ok: true });
  expect(result.tampered.ok).toBe(false);
  expect(result.beforeReview.acceptedHashes).toEqual([]);
  expect(result.admitted.acceptedHashes).toContain(result.sourceHash);
  expect(result.revoked.acceptedHashes).not.toContain(result.sourceHash);
  expect(result.sameAdmissionOwner).toBe(true);
  await testInfo.attach('evidence-browser-contract', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
