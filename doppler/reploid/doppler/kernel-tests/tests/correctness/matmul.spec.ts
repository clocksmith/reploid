/**
 * Matrix Multiplication Kernel Correctness Tests
 *
 * Validates the matmul.wgsl GPU kernel against reference JS implementation.
 * Priority: HIGH - foundation kernel used throughout
 */

import { test, expect } from './setup.js';

interface MatmulResult {
  maxError: number;
  M?: number;
  K?: number;
  N?: number;
  avgError?: number;
  batch?: number;
  hasNaN?: boolean;
  hasInf?: boolean;
  maxRelError?: number;
  maxAbsError?: number;
}

interface MatmulDims {
  M: number;
  K: number;
  N: number;
}

test.describe('Matrix Multiplication Kernel', () => {
  test.describe('Basic functionality', () => {
    test('should compute C = A @ B correctly', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const { matmulRef } = window.testHarness.references;

        const M = 4, K = 8, N = 4;

        // Create test matrices
        const A = new Float32Array(M * K);
        const B = new Float32Array(K * N);

        for (let i = 0; i < A.length; i++) A[i] = Math.random() * 2 - 1;
        for (let i = 0; i < B.length; i++) B[i] = Math.random() * 2 - 1;

        // Reference
        const refC = matmulRef(A, B, M, N, K);

        // GPU
        const gpu = await window.testHarness.getGPU();
        const gpuC = await window.testHarness.runMatmul(gpu.device, A, B, M, N, K);

        // Compare
        let maxError = 0;
        for (let i = 0; i < refC.length; i++) {
          maxError = Math.max(maxError, Math.abs(gpuC[i] - refC[i]));
        }

        return { maxError, M, K, N };
      });

      expect(result.maxError).toBeLessThan(1e-5);
    });

    test('should handle identity matrix', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const N = 4;

        // Create identity matrix
        const I = new Float32Array(N * N);
        for (let i = 0; i < N; i++) {
          I[i * N + i] = 1.0;
        }

        // Create random vector/matrix
        const A = new Float32Array(N * N);
        for (let i = 0; i < A.length; i++) {
          A[i] = Math.random() * 10;
        }

        const gpu = await window.testHarness.getGPU();

        // A @ I should equal A
        const result = await window.testHarness.runMatmul(gpu.device, A, I, N, N, N);

        let maxError = 0;
        for (let i = 0; i < A.length; i++) {
          maxError = Math.max(maxError, Math.abs(result[i] - A[i]));
        }

        return { maxError };
      });

      expect(result.maxError).toBeLessThan(1e-5);
    });

    test('should handle zero matrix', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<{ maxVal: number }> => {
        const M = 4, K = 8, N = 4;

        const A = new Float32Array(M * K);
        for (let i = 0; i < A.length; i++) A[i] = Math.random();

        const B = new Float32Array(K * N).fill(0); // Zero matrix

        const gpu = await window.testHarness.getGPU();
        const C = await window.testHarness.runMatmul(gpu.device, A, B, M, N, K);

        // Result should be all zeros
        let maxVal = 0;
        for (const v of C) {
          maxVal = Math.max(maxVal, Math.abs(v));
        }

        return { maxVal };
      });

      expect(result.maxVal).toBeLessThan(1e-6);
    });
  });

  test.describe('Matrix sizes', () => {
    const sizes = [
      { M: 1, K: 1, N: 1, name: 'scalar' },
      { M: 1, K: 64, N: 1, name: 'dot product' },
      { M: 64, K: 1, N: 64, name: 'outer product' },
      { M: 16, K: 16, N: 16, name: 'square small' },
      { M: 64, K: 64, N: 64, name: 'square medium' },
      { M: 128, K: 256, N: 64, name: 'rectangular' },
      { M: 32, K: 128, N: 32, name: 'tall K' },
    ];

    for (const size of sizes) {
      test(`should handle ${size.name} (${size.M}x${size.K}x${size.N})`, async ({ gpuPage }) => {
        const { M, K, N } = size;
        const result = await gpuPage.evaluate(async (dims: MatmulDims): Promise<MatmulResult> => {
          const { matmulRef } = window.testHarness.references;

          const { M, K, N } = dims;

          const A = new Float32Array(M * K);
          const B = new Float32Array(K * N);

          for (let i = 0; i < A.length; i++) A[i] = Math.random() * 2 - 1;
          for (let i = 0; i < B.length; i++) B[i] = Math.random() * 2 - 1;

          const refC = matmulRef(A, B, M, N, K);

          const gpu = await window.testHarness.getGPU();
          const gpuC = await window.testHarness.runMatmul(gpu.device, A, B, M, N, K);

          let maxError = 0;
          let sumError = 0;
          for (let i = 0; i < refC.length; i++) {
            const error = Math.abs(gpuC[i] - refC[i]);
            maxError = Math.max(maxError, error);
            sumError += error;
          }

          return {
            maxError,
            avgError: sumError / refC.length,
          };
        }, { M, K, N });

        // FP32 tolerance scales with K (accumulation)
        const tolerance = 1e-4 * Math.sqrt(K);
        expect(result.maxError).toBeLessThan(tolerance);
      });
    }
  });

  test.describe('Alpha scaling', () => {
    test('should apply alpha scaling', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const { matmulRef } = window.testHarness.references;

        const M = 4, K = 8, N = 4;
        const alpha = 2.5;

        const A = new Float32Array(M * K);
        const B = new Float32Array(K * N);

        for (let i = 0; i < A.length; i++) A[i] = Math.random();
        for (let i = 0; i < B.length; i++) B[i] = Math.random();

        const refC = matmulRef(A, B, M, N, K, alpha);

        const gpu = await window.testHarness.getGPU();
        const gpuC = await window.testHarness.runMatmul(gpu.device, A, B, M, N, K, alpha);

        let maxError = 0;
        for (let i = 0; i < refC.length; i++) {
          maxError = Math.max(maxError, Math.abs(gpuC[i] - refC[i]));
        }

        return { maxError };
      });

      expect(result.maxError).toBeLessThan(1e-4);
    });
  });

  test.describe('Batched matmul', () => {
    test('should compute batched C = A @ B', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const { batchMatmulRef } = window.testHarness.references;

        const batch = 4, M = 8, K = 16, N = 8;

        const A = new Float32Array(batch * M * K);
        const B = new Float32Array(batch * K * N);

        for (let i = 0; i < A.length; i++) A[i] = Math.random() * 2 - 1;
        for (let i = 0; i < B.length; i++) B[i] = Math.random() * 2 - 1;

        const refC = batchMatmulRef(A, B, batch, M, N, K);

        const gpu = await window.testHarness.getGPU();
        const gpuC = await window.testHarness.runBatchMatmul(gpu.device, A, B, batch, M, N, K);

        let maxError = 0;
        for (let i = 0; i < refC.length; i++) {
          maxError = Math.max(maxError, Math.abs(gpuC[i] - refC[i]));
        }

        return { maxError, batch, M, K, N };
      });

      expect(result.maxError).toBeLessThan(1e-4);
    });
  });

  test.describe('Matrix-vector multiplication', () => {
    test('should compute y = A @ x', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const { matvecRef } = window.testHarness.references;

        const M = 64, K = 128;

        const A = new Float32Array(M * K);
        const x = new Float32Array(K);

        for (let i = 0; i < A.length; i++) A[i] = Math.random() * 2 - 1;
        for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 - 1;

        const refY = matvecRef(A, x, M, K);

        const gpu = await window.testHarness.getGPU();
        const gpuY = await window.testHarness.runMatvec(gpu.device, A, x, M, K);

        let maxError = 0;
        for (let i = 0; i < refY.length; i++) {
          maxError = Math.max(maxError, Math.abs(gpuY[i] - refY[i]));
        }

        return { maxError };
      });

      expect(result.maxError).toBeLessThan(1e-4);
    });
  });

  test.describe('Numerical stability', () => {
    test('should handle large values', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const { matmulRef } = window.testHarness.references;

        const M = 16, K = 16, N = 16;

        const A = new Float32Array(M * K);
        const B = new Float32Array(K * N);

        // Large but representable values
        for (let i = 0; i < A.length; i++) A[i] = (Math.random() - 0.5) * 1000;
        for (let i = 0; i < B.length; i++) B[i] = (Math.random() - 0.5) * 1000;

        const refC = matmulRef(A, B, M, N, K);

        const gpu = await window.testHarness.getGPU();
        const gpuC = await window.testHarness.runMatmul(gpu.device, A, B, M, N, K);

        // Check for NaN/Inf
        let hasNaN = false;
        let hasInf = false;
        for (const v of gpuC) {
          if (isNaN(v)) hasNaN = true;
          if (!isFinite(v)) hasInf = true;
        }

        // Relative error for large values
        let maxRelError = 0;
        for (let i = 0; i < refC.length; i++) {
          if (Math.abs(refC[i]) > 1) {
            const relError = Math.abs(gpuC[i] - refC[i]) / Math.abs(refC[i]);
            maxRelError = Math.max(maxRelError, relError);
          }
        }

        return { hasNaN, hasInf, maxRelError, maxError: 0 };
      });

      expect(result.hasNaN).toBe(false);
      expect(result.hasInf).toBe(false);
      expect(result.maxRelError).toBeLessThan(1e-4);
    });

    test('should handle small values', async ({ gpuPage }) => {
      const result = await gpuPage.evaluate(async (): Promise<MatmulResult> => {
        const { matmulRef } = window.testHarness.references;

        const M = 16, K = 16, N = 16;

        const A = new Float32Array(M * K);
        const B = new Float32Array(K * N);

        // Small values
        for (let i = 0; i < A.length; i++) A[i] = (Math.random() - 0.5) * 1e-4;
        for (let i = 0; i < B.length; i++) B[i] = (Math.random() - 0.5) * 1e-4;

        const refC = matmulRef(A, B, M, N, K);

        const gpu = await window.testHarness.getGPU();
        const gpuC = await window.testHarness.runMatmul(gpu.device, A, B, M, N, K);

        let maxAbsError = 0;
        for (let i = 0; i < refC.length; i++) {
          maxAbsError = Math.max(maxAbsError, Math.abs(gpuC[i] - refC[i]));
        }

        return { maxAbsError, maxError: 0 };
      });

      // Very small values may have larger relative error but small absolute error
      expect(result.maxAbsError).toBeLessThan(1e-10);
    });
  });
});
