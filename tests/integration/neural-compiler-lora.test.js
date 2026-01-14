/**
 * @fileoverview Integration test for NeuralCompiler LoRA adapter wiring
 *
 * Tests:
 * 1. Register adapter manifest via NeuralCompiler.registerAdapter()
 * 2. Verify LLMClient.loadLoRAAdapter() calls Doppler provider
 */

const NeuralCompilerLoRATest = {
  name: 'NeuralCompiler LoRA Integration',

  async run(deps) {
    const { NeuralCompiler, LLMClient, VFS, Utils } = deps;
    const { logger } = Utils;
    const results = { passed: 0, failed: 0, tests: [] };

    const test = async (name, fn) => {
      try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'passed' });
        logger.info(`[TEST] PASS: ${name}`);
      } catch (err) {
        results.failed++;
        results.tests.push({ name, status: 'failed', error: err.message });
        logger.error(`[TEST] FAIL: ${name}`, err.message);
      }
    };

    // Test 1: Register adapter from manifest path
    await test('Register adapter from manifest path', async () => {
      const manifestPath = '/config/lora-adapters/react-forms.json';

      const entry = await NeuralCompiler.registerAdapter('react-forms', manifestPath, {
        routingText: 'React form input validation submit useState useForm'
      });

      if (!entry) throw new Error('registerAdapter returned null');
      if (entry.name !== 'react-forms') throw new Error('Name mismatch');
      if (!entry.manifestPath) throw new Error('Manifest path not stored');
    });

    // Test 2: Register adapter with inline manifest
    await test('Register adapter with inline manifest', async () => {
      const inlineManifest = {
        name: 'css-tailwind',
        version: '1.0.0',
        baseModel: 'gemma-3-1b-it',
        lora: { rank: 8, alpha: 16, targetModules: ['q_proj', 'v_proj'] },
        shards: []
      };

      const entry = await NeuralCompiler.registerAdapter('css-tailwind', null, {
        manifest: inlineManifest,
        routingText: 'CSS Tailwind styling flexbox grid responsive'
      });

      if (!entry) throw new Error('registerAdapter returned null');
      if (!entry.manifest) throw new Error('Inline manifest not stored');
    });

    // Test 3: List registered adapters
    await test('List registered adapters', async () => {
      const adapters = NeuralCompiler.listAdapters();

      if (!Array.isArray(adapters)) throw new Error('listAdapters should return array');
      if (adapters.length < 2) throw new Error('Expected at least 2 adapters');

      const names = adapters.map(a => a.name);
      if (!names.includes('react-forms')) throw new Error('react-forms not found');
      if (!names.includes('css-tailwind')) throw new Error('css-tailwind not found');
    });

    // Test 4: Verify LLMClient has loadLoRAAdapter method
    await test('LLMClient.loadLoRAAdapter exists', async () => {
      if (typeof LLMClient.loadLoRAAdapter !== 'function') {
        throw new Error('loadLoRAAdapter method not found on LLMClient');
      }
      if (typeof LLMClient.unloadLoRAAdapter !== 'function') {
        throw new Error('unloadLoRAAdapter method not found on LLMClient');
      }
      if (typeof LLMClient.getActiveLoRA !== 'function') {
        throw new Error('getActiveLoRA method not found on LLMClient');
      }
    });

    // Test 5: Attempt to load adapter (will fail without Doppler, but tests wiring)
    await test('Load adapter wiring (expects Doppler error)', async () => {
      try {
        // This will throw because Doppler provider isn't loaded in test env
        // But it proves the wiring is correct
        await LLMClient.loadLoRAAdapter({
          name: 'test-adapter',
          lora: { rank: 8 }
        });

        // If we get here, Doppler is actually available
        logger.info('[TEST] Doppler provider available - LoRA load succeeded');
      } catch (err) {
        // Expected errors that prove wiring works:
        const expectedErrors = [
          'DOPPLER provider',
          'not support LoRA',
          'not initialized',
          'provider not available'
        ];

        const isExpectedError = expectedErrors.some(e =>
          err.message.toLowerCase().includes(e.toLowerCase())
        );

        if (!isExpectedError) {
          throw new Error(`Unexpected error: ${err.message}`);
        }

        // Wiring is correct, just no Doppler backend
        logger.info('[TEST] Correct wiring, Doppler not available:', err.message);
      }
    });

    // Test 6: Unregister adapter
    await test('Unregister adapter', async () => {
      const removed = await NeuralCompiler.unregisterAdapter('css-tailwind');
      if (!removed) throw new Error('unregisterAdapter should return true');

      const adapters = NeuralCompiler.listAdapters();
      const names = adapters.map(a => a.name);
      if (names.includes('css-tailwind')) {
        throw new Error('css-tailwind should be removed');
      }
    });

    return results;
  }
};

export default NeuralCompilerLoRATest;
