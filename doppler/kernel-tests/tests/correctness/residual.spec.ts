/**
 * Residual Add Kernel Correctness Tests
 */

import { test, expect } from './setup.js';

interface ResidualResult {
  maxError: number;
  maxDiff?: number;
  hasNaN?: boolean;
  hasInf?: boolean;
}

test.describe('Residual Add Kernel', () => {
  test.describe('Basic functionality', () => {
    test('should add residual correctly', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<ResidualResult> => {
        const { residualAddRef } = window.testHarness.references;

        const size = 256;
        const x = new Float32Array(size);
        const residual = new Float32Array(size);

        for (let i = 0; i < size; i++) {
          x[i] = Math.random() * 2 - 1;
          residual[i] = Math.random() * 2 - 1;
        }

        const expected = residualAddRef(x, residual);

        const gpu = await window.testHarness.getGPU();
        const actual = await window.testHarness.runResidual(gpu.device, x, residual);

        let maxError = 0;
        for (let i = 0; i < expected.length; i++) {
          maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]));
        }

        return { maxError };
      });

      expect(result.maxError).toBeLessThan(1e-6);
    });

    test('should handle zero residual', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<ResidualResult> => {
        const size = 128;
        const x = new Float32Array(size);
        const residual = new Float32Array(size).fill(0);

        for (let i = 0; i < size; i++) {
          x[i] = Math.random() * 10;
        }

        const gpu = await window.testHarness.getGPU();
        const actual = await window.testHarness.runResidual(gpu.device, x, residual);

        // Output should equal x exactly
        let maxError = 0;
        for (let i = 0; i < size; i++) {
          maxError = Math.max(maxError, Math.abs(actual[i] - x[i]));
        }

        return { maxError };
      });

      expect(result.maxError).toBe(0);
    });

    test('should handle zero x', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<ResidualResult> => {
        const size = 128;
        const x = new Float32Array(size).fill(0);
        const residual = new Float32Array(size);

        for (let i = 0; i < size; i++) {
          residual[i] = Math.random() * 10;
        }

        const gpu = await window.testHarness.getGPU();
        const actual = await window.testHarness.runResidual(gpu.device, x, residual);

        // Output should equal residual exactly
        let maxError = 0;
        for (let i = 0; i < size; i++) {
          maxError = Math.max(maxError, Math.abs(actual[i] - residual[i]));
        }

        return { maxError };
      });

      expect(result.maxError).toBe(0);
    });
  });

  test.describe('Size variations', () => {
    const sizes = [1, 4, 16, 64, 256, 1024, 4096, 16384];

    for (const size of sizes) {
      test(`should handle size ${size}`, async ({ gpuPage }) => {
        const result = await gpuPage.evaluate(async (sz: number): Promise<ResidualResult> => {
          const { residualAddRef } = window.testHarness.references;

          const x = new Float32Array(sz);
          const residual = new Float32Array(sz);

          for (let i = 0; i < sz; i++) {
            x[i] = Math.random() * 2 - 1;
            residual[i] = Math.random() * 2 - 1;
          }

          const expected = residualAddRef(x, residual);

          const gpu = await window.testHarness.getGPU();
          const actual = await window.testHarness.runResidual(gpu.device, x, residual);

          let maxError = 0;
          for (let i = 0; i < expected.length; i++) {
            maxError = Math.max(maxError, Math.abs(actual[i] - expected[i]));
          }

          return { maxError };
        }, size);

        expect(result.maxError).toBeLessThan(1e-5);
      });
    }
  });

  test.describe('Numerical properties', () => {
    test('should be commutative', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<ResidualResult> => {
        const size = 256;
        const a = new Float32Array(size);
        const b = new Float32Array(size);

        for (let i = 0; i < size; i++) {
          a[i] = Math.random() * 10 - 5;
          b[i] = Math.random() * 10 - 5;
        }

        const gpu = await window.testHarness.getGPU();
        const ab = await window.testHarness.runResidual(gpu.device, a, b);
        const ba = await window.testHarness.runResidual(gpu.device, b, a);

        let maxDiff = 0;
        for (let i = 0; i < size; i++) {
          maxDiff = Math.max(maxDiff, Math.abs(ab[i] - ba[i]));
        }

        return { maxDiff, maxError: 0 };
      });

      expect(result.maxDiff).toBe(0);
    });

    test('should handle large values', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<ResidualResult> => {
        const size = 128;
        const x = new Float32Array(size);
        const residual = new Float32Array(size);

        for (let i = 0; i < size; i++) {
          x[i] = (Math.random() - 0.5) * 1e6;
          residual[i] = (Math.random() - 0.5) * 1e6;
        }

        const gpu = await window.testHarness.getGPU();
        const actual = await window.testHarness.runResidual(gpu.device, x, residual);

        let hasNaN = false;
        let hasInf = false;
        for (const v of actual) {
          if (isNaN(v)) hasNaN = true;
          if (!isFinite(v)) hasInf = true;
        }

        return { hasNaN, hasInf, maxError: 0 };
      });

      expect(result.hasNaN).toBe(false);
      expect(result.hasInf).toBe(false);
    });
  });
});
