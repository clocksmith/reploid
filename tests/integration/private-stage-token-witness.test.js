// @vitest-environment node
import { it, expect, vi } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createNativeRtcAdapter } from '../../server/native-rtc-adapter.js';
import { createResponses } from '../../server/responses.js';
import { openStageTokenWitness, verifyStageTokenWitnesses } from '../../server/fleet/stage-token-witness.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';

// The native binding is an optional package; minimal installations still exercise the full HTTP handler.
let wrtc;
try {
  ({ default: wrtc } = await import('@roamhq/wrtc'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@roamhq/wrtc')) throw error;
}
const verifier = fileURLToPath(new URL('../fixtures/verify-private-stage-tokens.mjs', import.meta.url));

// Individually signed logical peers share one loopback SCTP connection. Discovery and numerical
// stages are fixtures. All control, activation, and result frames traverse native RTCDataChannels.
async function rtcChannels() {
  const { RTCPeerConnection } = createNativeRtcAdapter(wrtc);
  const a = new RTCPeerConnection({ iceServers: [] }), b = new RTCPeerConnection({ iceServers: [] });
  const close = () => { a.close(); b.close(); };
  try {
    let next = 1;
    const open = label => {
      const options = { negotiated: true, id: next++, ordered: true };
      return [a.createDataChannel(label, options), b.createDataChannel(label, options)];
    };
    const bootstrap = open('bootstrap');
    const bind = async (source, target, description) => {
      await source.setLocalDescription(description);
      const deadline = Date.now() + 6000;
      while (source.iceGatheringState !== 'complete' && Date.now() < deadline) await delay(10);
      assert.equal(source.iceGatheringState, 'complete');
      await target.setRemoteDescription(source.localDescription);
    };
    await bind(a, b, await a.createOffer());
    await bind(b, a, await b.createAnswer());
    await vi.waitFor(() => expect(bootstrap.every(c => c.readyState === 'open')).toBe(true), { timeout: 4000 });
    return { pair: (_from, _to, label) => open(label), close };
  } catch (error) { close(); throw error; }
}

async function checkAttempt(link) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-witness-'));
  let mesh, api, server;
  try {
    mesh = await automaticOrderedMesh({ channelPair: link.pair });
    const participant = { ...mesh.meshes[5], roomId: 'reploid-swarm-private-token-check', executionClass: 'private-pool' };
    const requesterId = mesh.identities[5].peerId, stageParticipants = [0, 1, 2].map(i => mesh.identities[i].peerId);
    const messages = [{ role: 'user', content: tasks[0].prompt }];
    const original = mesh.states.map(state => ({ ...state.resident }));
    const active = original.slice();
    for (const i of [0, 2]) {
      for (const method of ['tokenize', 'executeStage']) mesh.states[i].resident[method] = input => active[i][method](input);
    }
    await mesh.prepare();
    await vi.waitFor(() => expect(mesh.select(5, 0)).toBeTruthy(), { timeout: 8000 });
    const choice = mesh.select(5, 0);
    const fixture = { modelId: mesh.model.id, modelIdentity: mesh.model.identity, planIdentity: choice.partition.planId,
      messages, maxOutputTokens: 3, reference: { inputIds: [1, 9], visibleOutputIds: [20, 21], stopId: 22,
        outputText: tasks[0].chunks.slice(0, 2).join('') } };
    const fixtureBytes = Buffer.from(JSON.stringify(fixture)), fixtureFile = path.join(dir, 'reference.json');
    await fs.writeFile(fixtureFile, fixtureBytes);
    api = createResponses({ participant, authenticate: async () => ({ subject: 'private-local-test' }), authorize: async () => true });
    server = http.createServer((req, res) => api.handle(req, res));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');

    async function run(stopId, capped = false) {
      const threadId = 'qualification-' + randomUUID(), file = id => path.join(dir, threadId + '-' + id);
      const frozen = capped ? Buffer.from(JSON.stringify({ ...fixture, reference: { inputIds: [1, 9],
        outputIds: [20, 21, 22], stopReason: 'max-tokens', outputText: fixture.reference.outputText } })) : fixtureBytes;
      const referenceFile = capped ? file('capped.json') : fixtureFile;
      if (capped) await fs.writeFile(referenceFile, frozen);
      const settings = { fixtureFile: referenceFile, threadId, requesterId, stageParticipants,
        fixtureSha256: createHash('sha256').update(frozen).digest('hex') };
      const prepare = i => openStageTokenWitness({ ...settings, receiptFile: file(i) },
        { roomId: participant.roomId, participantId: stageParticipants[i] });
      await expect(openStageTokenWitness({ ...settings, receiptFile: file(0) },
        { roomId: bootstrap.publicRoomId, participantId: stageParticipants[0] })).rejects.toThrow(/private pool/i);
      await expect(openStageTokenWitness({ ...settings, receiptFile: file(0), fixtureSha256: '0'.repeat(64) },
        { roomId: participant.roomId, participantId: stageParticipants[0] })).rejects.toThrow(/hash mismatch/i);
      active[0] = (await prepare(0)).wrap(original[0]);
      active[2] = (await prepare(2)).wrap({ ...original[2], async executeStage(input) {
        const result = await original[2].executeStage(input);
        // Both terminal IDs produce identical visible text. The observer must check the sampled ID itself.
        return result.done ? { ...result, delta: '', tokenId: stopId, stopReason: capped ? 'max-tokens' : 'eos-token' } : result;
      } });
      const res = await fetch('http://127.0.0.1:' + server.address().port + '/v1/responses', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: choice.selectionId ?? choice.id,
          input: messages, stream: true, reploid: { poolId: participant.roomId, conversationId: threadId,
            model: { identity: fixture.modelIdentity, planIdentity: fixture.planIdentity },
            execution: { protection: 'plaintext', route: 'auto', participants: { kind: 'named', ids: [...stageParticipants, requesterId] },
               allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] } } }) });
      const body = await res.text(); expect(res.status, body).toBe(200);
      const event = body.split('\n\n').find(frame => frame.startsWith(capped ? 'event: response.incomplete\n' : 'event: response.completed\n'));
      expect(event, body).toBeTruthy();
      const response = JSON.parse(event.split('\n')[1].slice(6)).response;
      const httpAttemptId = res.headers.get('x-reploid-attempt-id');
      const input = JSON.parse(await fs.readFile(file(0))), output = JSON.parse(await fs.readFile(file(2)));
      expect(response.output[0].content[0].text).toBe(fixture.reference.outputText);
      expect(body).not.toContain(output.sampleDigest);
      expect(body).not.toContain('tokenizerDigest');
      expect((await fs.stat(file(0))).mode & 0o777).toBe(0o600);
      await expect(prepare(0)).rejects.toThrow(/already exists/);
      await fs.writeFile(file('headers'), [...res.headers].map(([key, value]) => key + ': ' + value).join('\r\n') + '\r\n');
      await fs.writeFile(file('sse'), body);
      return { evidence: { fixtureBytes: frozen, response, httpAttemptId, input, output },
        verify: () => promisify(execFile)(process.execPath, [verifier, referenceFile, file('headers'), file('sse'), file(0), file(2)]) };
    }
    const good = await run(22);
    expect(good.evidence.response.reploid.execution.schema).toBe('reploid.mesh.partition-summary/v2');
    const expected = verifyStageTokenWitnesses(good.evidence);
    expect(expected).toMatchObject({ exact: true, promptCount: 2, sampleCount: 3, generation: { maxTokens: 3 } });
    expect(JSON.parse((await good.verify()).stdout)).toEqual(expected);
    const bad = await run(23);
    expect(() => verifyStageTokenWitnesses(bad.evidence)).toThrow(/sampled token/i);
    await expect(bad.verify()).rejects.toThrow(/sampled token/i);
    expect(() => verifyStageTokenWitnesses({ ...good.evidence, output: bad.evidence.output })).toThrow(/attempt/);
    const capped = await run(22, true);
    expect(JSON.parse((await capped.verify()).stdout)).toMatchObject({ exact: true, sampleCount: 3, stopReason: 'max-tokens' });
    expect(() => verifyStageTokenWitnesses({ ...good.evidence, response: capped.evidence.response })).toThrow(/terminal HTTP/);
    expect(mesh.opens.some(op => op.label === 'reploid-partitions-ordered')).toBe(true);
    expect(mesh.traffic.length).toBeGreaterThan(0);
  } finally {
    try {
      await api?.close();
      server?.closeAllConnections();
      if (server?.listening) await new Promise(done => server.close(done));
    } finally {
      try { await mesh?.close(); } finally { link.close(); await fs.rm(dir, { recursive: true, force: true }); }
    }
  }
}

it('binds tokenization and the sampled stop to the ordinary HTTP split attempt', () =>
  checkAttempt({ close() {} }), 45000);
it.runIf(wrtc)('verifies the HTTP attempt and rejects a changed stop across native WebRTC data channels', async () =>
  checkAttempt(await rtcChannels()), 45000);
