/**
 * CLI Types - Shared type definitions for DOPPLER CLI
 */

export type Command = 'test' | 'bench';

export type TestSuite =
  | 'correctness'      // Kernel correctness tests
  | 'demo'             // Demo UI test (model load + generate via app)
  | 'converter'        // Converter UI test
  | 'inference'        // Quick inference validation
  | 'quick'            // Quick validation (subset of correctness)
  | 'all';             // All tests

export type BenchSuite =
  | 'kernels'          // Kernel microbenchmarks
  | 'inference'        // Full inference benchmark
  | 'system'           // Storage/OPFS benchmarks
  | 'all';             // All benchmarks

// Legacy suite types for backward compatibility
export type LegacySuite =
  | 'bench:kernels'
  | 'bench:pipeline'
  | 'bench:system';

export type SuiteType = TestSuite | BenchSuite | LegacySuite;

export interface CLIOptions {
  command: Command;
  suite: SuiteType;
  model: string;
  baseUrl: string;
  /** Serve files directly from disk via Playwright routing (no dev server). */
  noServer: boolean;
  headed: boolean;
  verbose: boolean;
  filter: string | null;
  timeout: number;
  output: string | null;
  html: string | null;       // HTML report path (bench only)
  warmup: number;
  runs: number;
  maxTokens: number;         // For inference benchmarks
  temperature: number;       // For inference benchmarks
  prompt: string;            // Prompt size preset: xs, short, medium, long
  text: string | null;       // Custom prompt text (overrides prompt)
  file: string | null;       // Load prompt from file (overrides prompt)
  compare: string | null;    // Compare against baseline
  trace: string | null;      // Debug trace preset: quick, layers, attention, full
  /** Layer filter for debug trace categories (does NOT enable recorder batching). */
  traceLayers: number[] | null;
  debugLayers: number[] | null; // Specific layers to debug
  /** Playwright persistent profile directory.
   *  Controls browser storage persistence, including OPFS model cache. */
  profileDir: string | null;
  retries: number;           // Number of retries on failure
  quiet: boolean;            // Suppress JSON output
  help: boolean;
}

// Alias for backward compatibility
export type TestOptions = CLIOptions;

export interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

export interface SuiteResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  results: TestResult[];
}

export interface ComparisonResult {
  metric: string;
  baseline: number;
  current: number;
  delta: number;
  deltaPercent: number;
  improved: boolean;
}

export interface TTestResult {
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
  significant: boolean;
  meanA: number;
  meanB: number;
  stdA: number;
  stdB: number;
}
