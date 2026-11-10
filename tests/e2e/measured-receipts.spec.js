import { test, expect } from '@playwright/test';

test('measured receipt modules pass Verification Worker and browser signing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const snapshot = {};
    for (const file of ['vendor/reploid/artifacts/receipt.js', 'vendor/reploid/artifacts/whole-model-receipt.js', 'vendor/reploid/mesh/peer-generation.js',
      'vendor/reploid/artifacts/generation-terminal.js', 'vendor/reploid/mesh/generation-recovery.js', 'host/earning/contribution.js']) {
      const response = await fetch('/' + file);
      if (!response.ok) throw Error('Module unavailable: ' + file);
      snapshot['/' + file] = await response.text();
    }
    const verification = await new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(Error('Verification timeout')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(Error(error.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
    const { createSigningIdentity } = await import('/vendor/reploid/artifacts/identity.js');
    const { measureWholeModelReceipt } = await import('/vendor/reploid/artifacts/whole-model-receipt.js');
    const { createReceiptDraft, signReceiptDraft, countersignReceipt, verifyReceipt } = await import('/vendor/reploid/artifacts/receipt.js');
    const provider = await createSigningIdentity({ algorithm: 'ECDSA' }), consumer = await createSigningIdentity({ algorithm: 'ECDSA' });
    const measured = await measureWholeModelReceipt([{ role: 'user', content: 'browser fixture' }], {
      modelIdentity: 'sha256:' + 'a'.repeat(64), content: 'response',
      completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 7, generatedTokenCount: 3, stopReason: 'eos-token' } });
    const receipt = await countersignReceipt(await signReceiptDraft(await createReceiptDraft({ ...measured,
      provider: provider.peerId, consumer: consumer.peerId, model: 'fixture', jobHash: 'request:browser' }), provider), consumer);
    const { signGenerationTerminal, verifyGenerationTerminal } = await import('/vendor/reploid/artifacts/generation-terminal.js');
    const binding = { requestId: 'browser-terminal', provider: provider.peerId, consumer: consumer.peerId, model: 'fixture',
      modelIdentity: measured.modelIdentity, adapterIdentities: [], inputDigest: measured.inputDigest };
    const terminal = await signGenerationTerminal(binding, 'cancelled', provider);
    return { verification, signatures: await verifyReceipt(receipt), counts: [receipt.inputTokens, receipt.outputTokens],
      terminalValid: await verifyGenerationTerminal(terminal, binding), forgedValid: await verifyGenerationTerminal({ ...terminal, cleanup: 'pending' }, binding) };
  });
  expect(result.verification.passed, JSON.stringify(result.verification.errors)).toBe(true);
  expect(result.signatures).toEqual({ valid: true, providerValid: true, consumerValid: true });
  expect(result.counts).toEqual([7, 3]);
  expect(result.terminalValid).toBe(true);
  expect(result.forgedValid).toBe(false);
});
