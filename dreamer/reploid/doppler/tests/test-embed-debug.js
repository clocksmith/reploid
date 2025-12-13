#!/usr/bin/env node
/**
 * Direct embedding test - bypass browser caching
 */

import { chromium } from 'playwright';

const DEMO_URL = 'http://localhost:8080/demo/';
const MODEL_URL = 'http://localhost:8765';

async function runTest() {
  console.log('Testing embedding lookup with fresh browser context...\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-web-security'] // Allow cross-origin for local testing
  });

  // Create a fresh context with no caching
  const context = await browser.newContext({
    bypassCSP: true,
  });

  const page = await context.newPage();

  // Capture console
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[DEBUG]') || text.includes('Error') || text.includes('[Pipeline]') || text.includes('[Test]')) {
      console.log(text);
    }
  });

  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    // Add cache-busting timestamp
    const timestamp = Date.now();
    console.log('[1/3] Opening demo page...');
    await page.goto(`${DEMO_URL}?t=${timestamp}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    console.log('[2/3] Loading model and testing embeddings...');

    const result = await page.evaluate(async (modelUrl) => {
      try {
        // Import modules (browser will use no-cache headers)
        const { downloadModel } = await import('../storage/downloader.js');
        const { getDopplerLoader } = await import('../loader/doppler-loader.js');
        const { InferencePipeline } = await import('../inference/pipeline.js');
        const { initDevice, getDevice } = await import('../gpu/device.js');

        // Initialize GPU device
        console.log('[Test] Initializing GPU...');
        await initDevice();
        const device = getDevice();

        // Fetch manifest
        const manifestResponse = await fetch(`${modelUrl}/manifest.json`);
        const manifest = await manifestResponse.json();
        console.log('[Test] Model ID:', manifest.modelId);

        // Download model
        console.log('[Test] Downloading model...');
        const success = await downloadModel(modelUrl, (progress) => {
          if (progress.stage === 'downloading') {
            console.log(`[Test] Download: ${progress.percent}%`);
          }
        });

        if (!success) {
          return { error: 'Download failed' };
        }

        console.log('[Test] Download complete, creating pipeline...');

        // Create and initialize pipeline
        const pipeline = new InferencePipeline();
        await pipeline.initialize({ runtime: { debug: true } });
        await pipeline.loadModel(manifest);

        // Get embedding buffer
        const embedBuffer = pipeline.weights.get('embed');
        if (!embedBuffer) {
          return { error: 'Embeddings not loaded' };
        }

        const hiddenSize = pipeline.modelConfig.hiddenSize;
        const vocabSize = pipeline.modelConfig.vocabSize;

        console.log(`[Test] embedBuffer.size=${embedBuffer.size}, hiddenSize=${hiddenSize}, vocabSize=${vocabSize}`);

        // Test token IDs: 2 (BOS), 105 (<start_of_turn>), 0
        const testTokens = [0, 2, 105, 2430];
        const results = [];

        for (const tokenId of testTokens) {
          const byteOffset = tokenId * hiddenSize * 4;
          console.log(`[Test] Token ${tokenId}: byteOffset=${byteOffset}`);

          if (byteOffset + 64 > embedBuffer.size) {
            results.push({ tokenId, error: 'offset exceeds buffer' });
            continue;
          }

          // Read embedding at this offset
          const readBuf = device.createBuffer({
            label: `token_${tokenId}_read`,
            size: 64,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(embedBuffer, byteOffset, readBuf, 0, 64);
          device.queue.submit([encoder.finish()]);
          await readBuf.mapAsync(GPUMapMode.READ);
          const data = new Float32Array(readBuf.getMappedRange().slice(0));
          readBuf.unmap();
          readBuf.destroy();

          const min = Math.min(...data);
          const max = Math.max(...data);
          const allZero = data.every(x => x === 0);
          const first4 = Array.from(data.slice(0, 4)).map(v => v.toFixed(4));

          console.log(`[Test] Token ${tokenId}: min=${min.toFixed(4)}, max=${max.toFixed(4)}, allZero=${allZero}, first4=[${first4.join(', ')}]`);
          results.push({ tokenId, min, max, allZero, first4 });
        }

        // Now test the actual gather kernel
        console.log('\n[Test] Testing gather kernel directly...');

        // Import gather kernel
        const { runGather } = await import('../gpu/kernel-selector.js');
        const { acquireBuffer, releaseBuffer } = await import('../gpu/buffer-pool.js');

        // Create token buffer with test tokens
        const tokenIds = [2, 105, 2430, 107];
        const numTokens = tokenIds.length;

        const tokenIdBuffer = acquireBuffer(numTokens * 4, undefined, 'test_token_ids');
        device.queue.writeBuffer(tokenIdBuffer, 0, new Uint32Array(tokenIds));

        console.log(`[Test] Running gather with tokens [${tokenIds.join(', ')}]`);
        console.log(`[Test] Params: numTokens=${numTokens}, hiddenSize=${hiddenSize}, vocabSize=${vocabSize}`);
        console.log(`[Test] tokenIdBuffer.size=${tokenIdBuffer.size}, embedBuffer.size=${embedBuffer.size}`);

        // Run gather
        const outputBuffer = await runGather(
          tokenIdBuffer,
          embedBuffer,
          numTokens,
          hiddenSize,
          vocabSize
        );

        console.log(`[Test] Gather output buffer.size=${outputBuffer.size}`);

        // Read output
        const outReadBuf = device.createBuffer({
          label: 'gather_output_read',
          size: Math.min(256, outputBuffer.size),
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const outEncoder = device.createCommandEncoder();
        outEncoder.copyBufferToBuffer(outputBuffer, 0, outReadBuf, 0, outReadBuf.size);
        device.queue.submit([outEncoder.finish()]);
        await outReadBuf.mapAsync(GPUMapMode.READ);
        const gatherOut = new Float32Array(outReadBuf.getMappedRange().slice(0));
        outReadBuf.unmap();
        outReadBuf.destroy();

        const zeros = gatherOut.filter(x => x === 0).length;
        const outMin = Math.min(...gatherOut);
        const outMax = Math.max(...gatherOut);
        const outFirst8 = Array.from(gatherOut.slice(0, 8)).map(v => v.toFixed(4));

        console.log(`[Test] Gather output: zeros=${zeros}/${gatherOut.length}, min=${outMin.toFixed(4)}, max=${outMax.toFixed(4)}`);
        console.log(`[Test] Gather output first 8: [${outFirst8.join(', ')}]`);

        releaseBuffer(tokenIdBuffer);
        releaseBuffer(outputBuffer);

        return {
          success: true,
          embeddings: results,
          gatherOutput: { zeros, total: gatherOut.length, min: outMin, max: outMax, first8: outFirst8 }
        };
      } catch (err) {
        return { error: err.message, stack: err.stack };
      }
    }, MODEL_URL);

    console.log('\n[3/3] Results:');
    console.log('='.repeat(60));
    console.log(JSON.stringify(result, null, 2));
    console.log('='.repeat(60));

    console.log('\nBrowser will stay open for 20s...');
    await page.waitForTimeout(20000);

  } catch (err) {
    console.error('Test failed:', err.message);
  } finally {
    await browser.close();
  }
}

runTest().catch(console.error);
