#!/usr/bin/env node
/**
 * DOPPLER Unified Test Runner
 *
 * Consolidates all test approaches into a single entry point.
 * Can run tests headless (CI) or with browser (debug).
 *
 * Usage:
 *   node debug/test-runner.js              # Run all tests
 *   node debug/test-runner.js --quick      # Quick smoke test
 *   node debug/test-runner.js --debug      # Run with browser visible
 *   node debug/test-runner.js --filter=embed  # Run tests matching 'embed'
 *   node debug/test-runner.js --model=gemma   # Test specific model
 *
 * @module debug/test-runner
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Types
// ============================================================================

/**
 * Test runner configuration
 */
interface TestConfig {
  baseUrl: string;
  modelUrl: string;
  timeout: number;
  headless: boolean;
  slowMo: number;
  quickMode?: boolean;
  verbose?: boolean;
  filter?: string;
  model?: string;
}

/**
 * Test result status
 */
type TestStatus = 'passed' | 'failed' | 'skipped';

/**
 * Individual test result
 */
interface TestResult {
  name: string;
  status: TestStatus;
  result?: unknown;
  reason?: string;
  error?: string;
  durationMs: number;
}

/**
 * Aggregated test results
 */
interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  tests: TestResult[];
}

/**
 * Test run result (returned from test.run)
 */
interface TestRunResult {
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Test definition
 */
interface TestDef {
  name: string;
  tags?: string[];
  run: (page: Page, config: TestConfig) => Promise<TestRunResult>;
}

// ============================================================================
// Configuration
// ============================================================================

// Default configuration
const DEFAULT_CONFIG: TestConfig = {
  baseUrl: 'http://localhost:8080',
  modelUrl: 'http://localhost:8765',
  timeout: 180000, // 3 minutes
  headless: true,
  slowMo: 0,
};

// Test results collector
const results: TestResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: [],
};

// ============================================================================
// Argument Parsing
// ============================================================================

/**
 * Parse command line arguments.
 */
function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = { ...DEFAULT_CONFIG };

  for (const arg of args) {
    if (arg === '--quick') {
      config.quickMode = true;
      config.timeout = 60000;
    } else if (arg === '--debug') {
      config.headless = false;
      config.slowMo = 100;
    } else if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg.startsWith('--filter=')) {
      config.filter = arg.split('=')[1];
    } else if (arg.startsWith('--model=')) {
      config.model = arg.split('=')[1];
    } else if (arg.startsWith('--base-url=')) {
      config.baseUrl = arg.split('=')[1];
    } else if (arg.startsWith('--model-url=')) {
      config.modelUrl = arg.split('=')[1];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
DOPPLER Unified Test Runner

Usage: node debug/test-runner.js [options]

Options:
  --quick         Quick smoke test (reduced timeout)
  --debug         Run with browser visible
  --verbose, -v   Verbose output
  --filter=NAME   Run tests matching NAME
  --model=NAME    Test specific model (e.g., gemma, llama)
  --base-url=URL  Demo server URL (default: http://localhost:8080)
  --model-url=URL Model server URL (default: http://localhost:8765)
  --help, -h      Show this help

Examples:
  node debug/test-runner.js --quick
  node debug/test-runner.js --debug --filter=embed
  node debug/test-runner.js --model=gemma --verbose
`);
}

// ============================================================================
// Test Definitions
// ============================================================================

/**
 * Define test cases.
 */
const tests: TestDef[] = [
  {
    name: 'gpu-init',
    tags: ['unit', 'gpu'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      const result = await page.evaluate(async () => {
        try {
          const { initDevice, getDevice, getKernelCapabilities } = await import('../gpu/device.js');
          await initDevice();
          const device = getDevice();
          const caps = getKernelCapabilities();

          return {
            success: !!device,
            deviceLabel: device?.label || 'unknown',
            maxBufferSize: caps.maxBufferSize,
            maxWorkgroupSize: caps.maxWorkgroupSize,
            features: caps.features,
          };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      if (!result.success) {
        throw new Error(`GPU init failed: ${result.error}`);
      }

      return result;
    },
  },

  {
    name: 'buffer-pool',
    tags: ['unit', 'gpu'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      const result = await page.evaluate(async () => {
        try {
          const { initDevice } = await import('../gpu/device.js');
          const { acquireBuffer, releaseBuffer, getBufferPool } = await import(
            '../gpu/buffer-pool.js'
          );

          await initDevice();

          // Acquire some buffers
          const buf1 = acquireBuffer(1024, undefined, 'test1');
          const buf2 = acquireBuffer(2048, undefined, 'test2');

          const statsAfterAcquire = getBufferPool().getStats();

          // Release
          releaseBuffer(buf1);
          releaseBuffer(buf2);

          const statsAfterRelease = getBufferPool().getStats();

          return {
            success: true,
            acquired: statsAfterAcquire.activeBuffers,
            pooledAfterRelease: statsAfterRelease.pooledBuffers,
          };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      if (!result.success) {
        throw new Error(`Buffer pool test failed: ${result.error}`);
      }

      return result;
    },
  },

  {
    name: 'gather-kernel',
    tags: ['unit', 'kernel'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      const result = await page.evaluate(async () => {
        try {
          const { initDevice, getDevice } = await import('../gpu/device.js');
          const { runGather } = await import('../gpu/kernel-selector.js');
          const { acquireBuffer, releaseBuffer } = await import('../gpu/buffer-pool.js');

          await initDevice();
          const device = getDevice();

          // Create test embedding table (4 tokens, 8 dims)
          const vocabSize = 4;
          const hiddenSize = 8;
          const embedData = new Float32Array(vocabSize * hiddenSize);
          for (let i = 0; i < vocabSize; i++) {
            for (let j = 0; j < hiddenSize; j++) {
              embedData[i * hiddenSize + j] = i + j * 0.1;
            }
          }

          const embedBuffer = device.createBuffer({
            size: embedData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(embedBuffer, 0, embedData);

          // Create token IDs [1, 3]
          const tokenIds = [1, 3];
          const tokenIdBuffer = acquireBuffer(tokenIds.length * 4, undefined, 'token_ids');
          device.queue.writeBuffer(tokenIdBuffer, 0, new Uint32Array(tokenIds));

          // Run gather
          const outputBuffer = await runGather(
            tokenIdBuffer,
            embedBuffer,
            tokenIds.length,
            hiddenSize,
            vocabSize
          );

          // Read output
          const staging = device.createBuffer({
            size: outputBuffer.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(outputBuffer, 0, staging, 0, outputBuffer.size);
          device.queue.submit([encoder.finish()]);

          await staging.mapAsync(GPUMapMode.READ);
          const output = new Float32Array(staging.getMappedRange().slice(0));
          staging.unmap();
          staging.destroy();

          // Expected: row 1 and row 3 from embed table
          const expected1 = Array.from(embedData.slice(1 * hiddenSize, 2 * hiddenSize));
          const expected3 = Array.from(embedData.slice(3 * hiddenSize, 4 * hiddenSize));
          const actual1 = Array.from(output.slice(0, hiddenSize));
          const actual3 = Array.from(output.slice(hiddenSize, 2 * hiddenSize));

          const match1 = expected1.every((v, i) => Math.abs(v - actual1[i]) < 1e-5);
          const match3 = expected3.every((v, i) => Math.abs(v - actual3[i]) < 1e-5);

          releaseBuffer(tokenIdBuffer);
          releaseBuffer(outputBuffer);
          embedBuffer.destroy();

          return { success: match1 && match3, match1, match3 };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      if (!result.success) {
        throw new Error(`Gather kernel test failed: ${result.error}`);
      }

      return result;
    },
  },

  {
    name: 'matmul-kernel',
    tags: ['unit', 'kernel'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      const result = await page.evaluate(async () => {
        try {
          const { initDevice, getDevice } = await import('../gpu/device.js');
          const { runMatmul } = await import('../gpu/kernel-selector.js');

          await initDevice();
          const device = getDevice();

          // Simple 2x3 * 3x2 matmul
          const M = 2,
            N = 2,
            K = 3;
          const A = new Float32Array([1, 2, 3, 4, 5, 6]); // 2x3
          const B = new Float32Array([1, 2, 3, 4, 5, 6]); // 3x2

          const bufA = device.createBuffer({
            size: A.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          const bufB = device.createBuffer({
            size: B.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          });
          device.queue.writeBuffer(bufA, 0, A);
          device.queue.writeBuffer(bufB, 0, B);

          const bufC = await runMatmul(bufA, bufB, M, N, K);

          // Read result
          const staging = device.createBuffer({
            size: bufC.size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(bufC, 0, staging, 0, bufC.size);
          device.queue.submit([encoder.finish()]);

          await staging.mapAsync(GPUMapMode.READ);
          const output = new Float32Array(staging.getMappedRange().slice(0));
          staging.unmap();

          // Expected: A * B
          // [1,2,3] * [1,3,5]^T = 1+6+15 = 22, [1,2,3] * [2,4,6]^T = 2+8+18 = 28
          // [4,5,6] * [1,3,5]^T = 4+15+30 = 49, [4,5,6] * [2,4,6]^T = 8+20+36 = 64
          const expected = [22, 28, 49, 64];
          const match = expected.every((v, i) => Math.abs(v - output[i]) < 1e-3);

          staging.destroy();
          bufA.destroy();
          bufB.destroy();

          return { success: match, output: Array.from(output), expected };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      if (!result.success) {
        throw new Error(
          `Matmul test failed: ${result.error}, got ${result.output}, expected ${result.expected}`
        );
      }

      return result;
    },
  },

  {
    name: 'command-recorder',
    tags: ['unit', 'gpu', 'batching'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      const result = await page.evaluate(async () => {
        try {
          const { initDevice, getDevice } = await import('../gpu/device.js');
          const { createCommandRecorder } = await import('../gpu/command-recorder.js');

          await initDevice();
          const device = getDevice();

          // Create recorder
          const recorder = createCommandRecorder('test');

          // Create some temp buffers
          const buf1 = recorder.createTempBuffer(256, GPUBufferUsage.STORAGE, 'temp1');
          const buf2 = recorder.createTempBuffer(
            512,
            GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            'temp2'
          );

          const stats = recorder.getStats();

          // Submit
          recorder.submit();

          return {
            success: true,
            tempBufferCount: stats.tempBufferCount,
            opCount: stats.opCount,
          };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      if (!result.success) {
        throw new Error(`Command recorder test failed: ${result.error}`);
      }

      return result;
    },
  },

  {
    name: 'debug-module',
    tags: ['unit', 'debug'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      const result = await page.evaluate(async () => {
        try {
          const { log, tensor, perf, setLogLevel, getLogHistory, clearLogHistory } = await import(
            '../debug/index.js'
          );

          clearLogHistory();
          setLogLevel('debug');

          // Test logging
          log.debug('Test', 'Debug message');
          log.info('Test', 'Info message');
          log.warn('Test', 'Warning message');

          // Test perf
          perf.mark('test-op');
          await new Promise((r) => setTimeout(r, 10));
          const duration = perf.measure('test-op', 'Test');

          // Test tensor inspection
          const testData = new Float32Array([1, 2, 3, 4, 5, NaN, Infinity, 0]);
          const stats = tensor.healthCheck(testData, 'test-tensor');

          const history = getLogHistory({ module: 'Test' });

          return {
            success: true,
            logCount: history.length,
            perfDuration: duration > 0,
            healthIssues: stats.issues,
          };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      });

      if (!result.success) {
        throw new Error(`Debug module test failed: ${result.error}`);
      }

      return result;
    },
  },

  {
    name: 'model-load',
    tags: ['integration', 'model'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      if (config.quickMode) {
        return { skipped: true, reason: 'Skipped in quick mode' };
      }

      const result = await page.evaluate(async (modelUrl: string) => {
        try {
          const { downloadModel } = await import('../storage/downloader.js');
          const { getDopplerLoader } = await import('../loader/doppler-loader.js');
          const { initDevice, getDevice } = await import('../gpu/device.js');

          await initDevice();

          // Fetch manifest
          const manifestResponse = await fetch(`${modelUrl}/manifest.json`);
          if (!manifestResponse.ok) {
            return { success: false, error: 'Could not fetch manifest' };
          }
          const manifest = await manifestResponse.json();

          // Try to download (or use cached)
          const success = await downloadModel(modelUrl, (progress) => {
            if (progress.stage === 'downloading' && (progress.percent ?? 0) % 20 === 0) {
              console.log(`[Test] Download: ${progress.percent ?? 0}%`);
            }
          });

          if (!success) {
            return { success: false, error: 'Download failed' };
          }

          // Create loader
          const loader = getDopplerLoader();
          await loader.load(manifest);

          return {
            success: true,
            modelId: manifest.modelId,
            numLayers: manifest.config?.numLayers || 'unknown',
          };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }, config.modelUrl);

      if (!result.success) {
        throw new Error(`Model load test failed: ${result.error}`);
      }

      return result;
    },
  },

  {
    name: 'inference-e2e',
    tags: ['e2e', 'model'],
    async run(page: Page, config: TestConfig): Promise<TestRunResult> {
      if (config.quickMode) {
        return { skipped: true, reason: 'Skipped in quick mode' };
      }

      // Use demo UI for e2e test
      await page.goto(`${config.baseUrl}/demo/`, { waitUntil: 'networkidle', timeout: 30000 });

      // Wait for UI
      await page.waitForSelector('#model-list', { timeout: 10000 });
      await page.waitForTimeout(2000);

      // Find and click model
      const modelName = config.model || 'gemma';
      const modelElements = await page.locator('#model-list *').all();

      let clicked = false;
      for (const elem of modelElements) {
        const text = await elem.textContent().catch(() => '');
        if (
          text?.toLowerCase().includes(modelName.toLowerCase()) &&
          text?.toLowerCase().includes('1b')
        ) {
          try {
            await elem.click({ timeout: 2000 });
            clicked = true;
            break;
          } catch {
            // Continue
          }
        }
      }

      if (!clicked) {
        return { success: false, error: `Could not find model: ${modelName}` };
      }

      // Wait for model to load
      await page.waitForFunction(
        () => {
          const textarea = document.querySelector('#chat-input') as HTMLTextAreaElement | null;
          return textarea && !textarea.disabled;
        },
        { timeout: 120000 }
      );

      // Send test prompt
      const prompt = 'the sky is';
      await page.locator('#chat-input').fill(prompt);
      await page.locator('#send-btn').click();

      // Wait for output
      await page.waitForTimeout(10000);

      // Check for generated text
      const output = await page.evaluate(() => {
        const messages = document.querySelectorAll('.message');
        const lastMessage = messages[messages.length - 1];
        return lastMessage?.textContent || '';
      });

      const hasOutput = output.length > prompt.length;

      return { success: hasOutput, outputLength: output.length, prompt };
    },
  },
];

// ============================================================================
// Test Runner
// ============================================================================

/**
 * Run a single test.
 */
async function runTest(page: Page, test: TestDef, config: TestConfig): Promise<TestStatus> {
  const startTime = performance.now();
  let result: TestRunResult;

  try {
    result = await test.run(page, config);

    if (result.skipped) {
      results.skipped++;
      results.tests.push({
        name: test.name,
        status: 'skipped',
        reason: result.reason,
        durationMs: performance.now() - startTime,
      });
      return 'skipped';
    }

    results.passed++;
    results.tests.push({
      name: test.name,
      status: 'passed',
      result,
      durationMs: performance.now() - startTime,
    });
    return 'passed';
  } catch (error) {
    results.failed++;
    results.tests.push({
      name: test.name,
      status: 'failed',
      error: (error as Error).message,
      durationMs: performance.now() - startTime,
    });
    return 'failed';
  }
}

/**
 * Main test runner.
 */
async function main(): Promise<void> {
  const config = parseArgs();

  console.log('='.repeat(60));
  console.log('DOPPLER Unified Test Runner');
  console.log('='.repeat(60));
  console.log(`Config: ${JSON.stringify({ ...config, filter: config.filter || 'all' }, null, 2)}`);
  console.log('');

  // Filter tests
  let testsToRun = tests;
  if (config.filter) {
    testsToRun = tests.filter(
      (t) =>
        t.name.includes(config.filter!) || t.tags?.some((tag) => tag.includes(config.filter!))
    );
  }

  console.log(`Running ${testsToRun.length} tests...`);
  console.log('');

  // Launch browser
  const browser: Browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.slowMo,
  });

  const context: BrowserContext = await browser.newContext({
    bypassCSP: true,
  });

  const page: Page = await context.newPage();

  // Capture console in verbose mode
  if (config.verbose) {
    page.on('console', (msg) => {
      console.log(`  [Browser] ${msg.text()}`);
    });
  }

  page.on('pageerror', (err) => {
    console.error(`  [PageError] ${err.message}`);
  });

  // Navigate to base URL for tests that don't need demo
  await page.goto(`${config.baseUrl}/`, { waitUntil: 'networkidle', timeout: 30000 });

  // Run tests
  for (const test of testsToRun) {
    process.stdout.write(`  ${test.name.padEnd(30)}`);

    const status = await runTest(page, test, config);

    const testResult = results.tests[results.tests.length - 1];
    const duration = testResult.durationMs.toFixed(0);

    if (status === 'passed') {
      console.log(`PASS  (${duration}ms)`);
    } else if (status === 'skipped') {
      console.log(`SKIP  (${testResult.reason})`);
    } else {
      console.log(`FAIL  (${testResult.error})`);
    }
  }

  // Cleanup
  await browser.close();

  // Print summary
  console.log('');
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`  Passed:  ${results.passed}`);
  console.log(`  Failed:  ${results.failed}`);
  console.log(`  Skipped: ${results.skipped}`);
  console.log('');

  if (results.failed > 0) {
    console.log('Failed tests:');
    for (const test of results.tests.filter((t) => t.status === 'failed')) {
      console.log(`  - ${test.name}: ${test.error}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
