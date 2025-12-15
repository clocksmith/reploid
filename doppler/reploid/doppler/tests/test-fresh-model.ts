#!/usr/bin/env node
/**
 * Test fresh Gemma 3 1B model from port 8766
 */

import { chromium, type BrowserContext, type Page } from 'playwright';

const DEMO_URL = 'http://localhost:8080/demo/';
// Use fresh Q4_K_M model converted from safetensors
const MODEL_URL = 'http://localhost:8765';
const PROMPT = 'the color of the sky is';

interface LoadResult {
  success?: boolean;
  error?: string;
  stack?: string;
}

interface InferenceResult {
  output?: string;
  error?: string;
  stack?: string;
}

async function runTest(): Promise<void> {
  console.log('='.repeat(60));
  console.log('Testing Fresh Gemma 3 1B (GGUF naming)');
  console.log('='.repeat(60));
  console.log(`Model URL: ${MODEL_URL}`);
  console.log(`Prompt: "${PROMPT}"`);
  console.log('');

  const userDataDir = `/tmp/playwright-test-${Date.now()}`;
  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    bypassCSP: true,
    args: [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-http-cache',
    ],
  });
  const page: Page = await context.newPage();

  const logs: string[] = [];

  // Capture console
  page.on('console', msg => {
    const text = msg.text();
    logs.push(text);

    // Print important logs
    if (text.includes('Prefill logits:') ||
        text.includes('Decode[') ||
        text.includes('OUTPUT') ||
        text.includes('top-5:') ||
        text.includes('[DopplerLoader]') ||
        text.includes('[Pipeline]') ||
        text.includes('[DEBUG]') ||
        text.includes('Loading') ||
        text.includes('Error') ||
        text.includes('not found')) {
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    // Open demo page
    console.log('\n[1/4] Opening demo page...');
    await page.goto(DEMO_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for page to be ready
    await page.waitForTimeout(2000);

    // Inject model loading code
    console.log('\n[2/4] Loading model from fresh RDRR...');

    const loadResult: LoadResult = await page.evaluate(async (modelUrl: string): Promise<LoadResult> => {
      try {
        // Import modules
        const { downloadModel } = await import('../storage/downloader.js');
        const { getDopplerLoader } = await import('../loader/doppler-loader.js');
        const { InferencePipeline } = await import('../inference/pipeline.js');
        const { initDevice, getDevice, getKernelCapabilities } = await import('../gpu/device.js');

        // Initialize GPU device
        console.log('[Test] Initializing GPU...');
        await initDevice();
        const device = getDevice();
        const gpuCaps = getKernelCapabilities();

        // First fetch manifest to get model ID
        const manifestResponse = await fetch(`${modelUrl}/manifest.json`);
        const manifest = await manifestResponse.json();
        const modelId = manifest.modelId;
        console.log('[Test] Model ID:', modelId);

        // Download model
        console.log('[Test] Downloading model from', modelUrl);
        const success = await downloadModel(modelUrl, (progress: any) => {
          if (progress.stage === 'manifest') {
            console.log('[Test] Got manifest');
          } else if (progress.stage === 'downloading') {
            console.log(`[Test] Download: ${progress.percent}%`);
          }
        });

        if (!success) {
          return { error: 'Download failed' };
        }

        console.log('[Test] Download complete, creating pipeline...');

        // Create pipeline with GPU context
        const pipeline = new InferencePipeline();

        // Initialize pipeline with GPU context (critical for GPU path!)
        await pipeline.initialize({
          gpu: {
            capabilities: gpuCaps,
            device: device,
          },
          runtime: { debug: true }
        });

        // Load model - pipeline._loadWeights will use getDopplerLoader()
        await pipeline.loadModel(manifest);

        // Store globally for inference
        (window as any)._testPipeline = pipeline;

        return { success: true };
      } catch (err) {
        const error = err as Error;
        return { error: error.message, stack: error.stack };
      }
    }, MODEL_URL);

    if (loadResult.error) {
      console.error('Load failed:', loadResult.error);
      if (loadResult.stack) console.error(loadResult.stack);
      await page.waitForTimeout(10000);
      await context.close();
      return;
    }

    console.log('\n[3/4] Running inference...');

    const inferenceResult: InferenceResult = await page.evaluate(async (prompt: string): Promise<InferenceResult> => {
      try {
        const pipeline = (window as any)._testPipeline;
        if (!pipeline) {
          return { error: 'Pipeline not found' };
        }

        console.log('[Test] Starting inference with prompt:', prompt);

        // generate() is an async generator - collect all tokens
        let output = '';
        const generator = pipeline.generate(prompt, {
          maxTokens: 10,
          temperature: 0.0,  // Greedy sampling to test deterministic output
          topP: 1.0,
          topK: 1,
          useChatTemplate: false  // Test without chat template
        });

        for await (const token of generator) {
          output += token;
          console.log(`[Test] Token: "${token}"`);
        }

        return { output };
      } catch (err) {
        const error = err as Error;
        return { error: error.message, stack: error.stack };
      }
    }, PROMPT);

    console.log('\n[4/4] Results:');
    console.log('='.repeat(60));

    if (inferenceResult.error) {
      console.error('Inference failed:', inferenceResult.error);
      if (inferenceResult.stack) console.error(inferenceResult.stack);
    } else {
      console.log('Output:', inferenceResult.output);

      // Check quality
      const output = (inferenceResult.output || '').toLowerCase();
      const goodTokens = ['blue', 'clear', 'beautiful', 'vast', 'dark', 'night', 'bright', 'color', 'sky'];
      const badPatterns = ['unused', 'ನ', 'మా', 'マ', 'thức'];

      const hasGood = goodTokens.some(t => output.includes(t));
      const hasBad = badPatterns.some(t => output.includes(t));

      console.log('');
      if (hasBad) {
        console.log('STATUS: FAIL - Still producing garbage tokens');
      } else if (hasGood) {
        console.log('STATUS: PASS - Producing coherent output!');
      } else {
        console.log('STATUS: UNKNOWN - Check output above');
      }
    }

    console.log('='.repeat(60));

    // Check logs for specific issues
    const tensorNotFound = logs.filter(l => l.includes('not found') && l.includes('tensor'));
    if (tensorNotFound.length > 0) {
      console.log('\nTensor loading issues:');
      tensorNotFound.forEach(l => console.log('  ', l));
    }

    console.log('\nBrowser will stay open for 30s...');
    await page.waitForTimeout(30000);

  } catch (err) {
    const error = err as Error;
    console.error('\nTest failed:', error.message);
    console.log('\nRecent logs:');
    logs.slice(-20).forEach(l => console.log('  ', l.slice(0, 150)));
  } finally {
    await context.close();
  }
}

runTest().catch(console.error);
