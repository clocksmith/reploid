import { test, expect } from '@playwright/test';

// Real local-tab WebRTC; computation and grant decisions are injected test ports.
// This does not qualify GPU inference, signed host grants, or conversation integration.
test('two tabs transfer binary partition steps with isolated replay, cancellation and peer loss', async ({ context }, testInfo) => {
  test.setTimeout(60000);
  await context.route('**/partition-channel-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Partition channel contract</title>',
  }));
  const a = await context.newPage(), b = await context.newPage();
  try {
    await Promise.all([a, b].map(page => page.goto('/partition-channel-probe')));
    await Promise.all([a, b].map((page, index) => page.evaluate(async index => {
      const { createPartitionDataChannel } = await import('/vendor/reploid/transport/index.js');
      const { createPartitionStepReceiver } = await import('/vendor/reploid/mesh/partitions/partition-step-receiver.js');
      const state = window.partitionProbe = { calls: [], settled: [], revoked: [], entered: false, release: null };
      const pc = state.pc = new RTCPeerConnection({ iceServers: [] });
      const channel = state.channel = pc.createDataChannel('reploid-partitions-v1', { negotiated: true, id: 0, ordered: true });
      const permitted = request => request.identity?.participantA === 'a' && request.identity?.participantB === 'b'
        && request.grant?.id === 'fixture-grant' && !state.revoked.includes(request.identity.threadId);
      state.receiver = createPartitionStepReceiver({
        limits: { maxAttempts: 16, maxSteps: 16 }, authorize: async request => permitted(request),
        fingerprint: async request => {
          const json = JSON.stringify({ ...request, payload: [...request.payload] });
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
          return 'sha256:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        },
        executeStep: async (request, { signal }) => {
          state.calls.push([request.identity.threadId, request.step]);
          if (request.identity.threadId === 'held' || request.identity.threadId === 'lost') {
            state.signal = signal; state.entered = true;
            await new Promise(resolve => { state.release = resolve; });
          }
          const values = new Float32Array(request.payload.buffer, request.payload.byteOffset, request.payload.byteLength / 4);
          return { identity: request.identity, step: request.step, tokenPosition: request.tokenPosition,
            tokenId: values[0] + 1, delta: String(values[0] + 1), done: false };
        },
        settleAttempt: async identity => { state.settled.push(identity.attemptId); },
      });
      state.endpoint = createPartitionDataChannel({ channel,
        localParticipantId: index === 0 ? 'a' : 'b', remoteParticipantId: index === 0 ? 'b' : 'a',
        limits: { maxFrameBytes: 128, maxControlBytes: 4096, maxPayloadBytes: 8192, maxPendingBytes: 32768,
          maxPendingRequests: 8, maxRequestsPerChannel: 128, maxBufferedBytes: 8192, maxTransferBytes: 1048576, timeoutMs: 10000 },
        authorize: async ({ metadata }) => permitted(metadata),
        serve: async (metadata, bytes, { signal }) => {
          if (metadata.operation === 'settle') {
            await state.receiver.closeAttempt(metadata.identity); return { settled: true };
          }
          return state.receiver.receive({ ...metadata, payload: bytes }, { signal });
        },
      });
      state.metadata = (threadId, step = 0) => ({ operation: 'step', identity: { modelId: 'injected',
        modelIdentity: 'sha256:' + 'a'.repeat(64), planId: 'fixture-plan', threadId, attemptId: 'attempt-' + threadId,
        participantA: 'a', participantB: 'b' }, step, tokenPosition: step, inputTokenCount: 1, grant: { id: 'fixture-grant' } });
      state.bytes = value => new Uint8Array(new Float32Array(512).fill(value).buffer);
      state.describe = async type => {
        await pc.setLocalDescription(type === 'offer' ? await pc.createOffer() : await pc.createAnswer());
        if (pc.iceGatheringState !== 'complete') await new Promise(resolve => {
          pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve(); });
        });
        return pc.localDescription.toJSON();
      };
    }, index)));
    const offer = await a.evaluate(() => window.partitionProbe.describe('offer'));
    await b.evaluate(offer => window.partitionProbe.pc.setRemoteDescription(offer), offer);
    const answer = await b.evaluate(() => window.partitionProbe.describe('answer'));
    await a.evaluate(answer => window.partitionProbe.pc.setRemoteDescription(answer), answer);
    await Promise.all([a, b].map(page => page.waitForFunction(() => window.partitionProbe.channel.readyState === 'open', null, { timeout: 10000 })));

    const results = await a.evaluate(async () => {
      const s = window.partitionProbe;
      return Promise.all(['one', 'two'].map(async (thread, index) => {
        let token = index * 10;
        const tokens = [];
        for (let step = 0; step < 3; step++) {
          const result = await s.endpoint.request(s.metadata(thread, step), s.bytes(token));
          if (result.identity.threadId !== thread || result.step !== step) throw new Error('mixed reply');
          token = result.tokenId; tokens.push(token);
        }
        return tokens;
      }));
    });
    expect(results).toEqual([[1, 2, 3], [11, 12, 13]]);
    // A new wire request for the same step must not advance receiver state again.
    expect(await a.evaluate(async () => {
      const s = window.partitionProbe;
      return s.endpoint.request(s.metadata('one', 2), s.bytes(2));
    })).toMatchObject({ tokenId: 3 });
    expect(await b.evaluate(() => window.partitionProbe.calls.length)).toBe(6);
    await b.evaluate(() => window.partitionProbe.revoked.push('one'));
    expect(await a.evaluate(async () => {
      const s = window.partitionProbe;
      return s.endpoint.request(s.metadata('one', 2), s.bytes(2)).then(() => 'unexpected', error => error.message);
    })).toContain('declined');

    await a.evaluate(() => {
      const s = window.partitionProbe; s.controller = new AbortController();
      s.pending = s.endpoint.request(s.metadata('held'), s.bytes(0), { signal: s.controller.signal })
        .then(() => 'unexpected', error => error.message);
    });
    await b.waitForFunction(() => window.partitionProbe.entered);
    await a.evaluate(() => window.partitionProbe.controller.abort());
    expect(await a.evaluate(() => window.partitionProbe.pending)).toContain('cancelled');
    await b.waitForFunction(() => window.partitionProbe.signal.aborted);
    expect(await a.evaluate(async () => {
      const s = window.partitionProbe;
      return s.endpoint.request(s.metadata('two', 3), s.bytes(13));
    })).toMatchObject({ tokenId: 14 });
    await b.evaluate(() => window.partitionProbe.release());
    expect(await a.evaluate(async () => {
      const s = window.partitionProbe;
      return s.endpoint.request({ ...s.metadata('held'), operation: 'settle' }, new Uint8Array());
    })).toEqual({ settled: true });
    expect(await b.evaluate(() => window.partitionProbe.settled)).toContain('attempt-held');

    const receipts = await Promise.all([a, b].map(page => page.evaluate(() => window.partitionProbe.endpoint.getReceipt())));
    expect(receipts[0].sentFrameBytes).toBe(receipts[1].receivedFrameBytes);
    expect(receipts[0].receivedFrameBytes).toBe(receipts[1].sentFrameBytes);
    expect(receipts[0].sentFrames).toBeGreaterThan(100);
    await testInfo.attach('partition-channel.json', { contentType: 'application/json', body: JSON.stringify({
      scope: 'two local tabs, real WebRTC, injected computation and grant decisions', results, receipts,
    }, null, 2) });

    await b.evaluate(() => { window.partitionProbe.entered = false; });
    await a.evaluate(() => {
      const s = window.partitionProbe;
      s.pending = s.endpoint.request(s.metadata('lost'), s.bytes(0)).then(() => 'unexpected', error => error.message);
    });
    await b.waitForFunction(() => window.partitionProbe.entered);
    await b.evaluate(() => window.partitionProbe.pc.close());
    expect(await a.evaluate(() => window.partitionProbe.pending)).toContain('disconnected');
    await b.evaluate(() => window.partitionProbe.release());
  } finally {
    await Promise.all([a, b].map(async page => {
      await page.evaluate(async () => {
        const s = window.partitionProbe;
        s?.release?.(); s?.endpoint.close(); s?.pc.close(); await s?.receiver.close();
      }).catch(() => {});
      await page.close();
    }));
  }
});
