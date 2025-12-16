/**
 * test-config.ts - Shared Test Configuration
 *
 * Centralizes model presets, token validation, log patterns, and URLs.
 * Used by both direct (minimal) and demo mode tests.
 *
 * @module tests/helpers/test-config
 */

// ============================================
// URL Configuration
// ============================================

export const URLS = {
  // Demo UI served at / in doppler-only mode (doppler/index.html)
  demo: 'http://localhost:8080/',
  // Minimal test page
  minimal: 'http://localhost:8080/tests/test-minimal.html',
  // Model server (for direct mode)
  modelServer: 'http://localhost:8080',
};

// ============================================
// Model Presets
// ============================================

export interface ModelConfig {
  name: string;
  pattern: RegExp;
  searchTerms: string[];
  excludeTerms: string[];
  timeouts: {
    load: number;
    generate: number;
  };
  extraLogPatterns: string[];
  headless: boolean;
}

export interface ModelConfigs {
  [key: string]: ModelConfig;
}

export const MODELS: ModelConfigs = {
  gemma: {
    name: 'Gemma 3 1B',
    pattern: /gemma.*1b/i,
    searchTerms: ['gemma', '1b'],
    excludeTerms: ['4b'],
    timeouts: {
      load: 90000,
      generate: 30000,
    },
    extraLogPatterns: [],
    headless: true,
  },

  mistral: {
    name: 'Mistral 7B',
    pattern: /mistral|7b/i,
    searchTerms: ['mistral', '7b'],
    excludeTerms: [],
    timeouts: {
      load: 120000,
      generate: 60000,
    },
    extraLogPatterns: ['rope'],
    headless: false,
  },

  gptoss: {
    name: 'GPT-OSS 20B',
    pattern: /gptoss|20b/i,
    searchTerms: ['gptoss', '20b'],
    excludeTerms: [],
    timeouts: {
      load: 180000,
      generate: 90000,
    },
    extraLogPatterns: ['expert', 'MoE', 'router'],
    headless: false,
  },

  // For embed/diagnostic tests
  embed: {
    name: 'Mistral 7B (Embed Test)',
    pattern: /mistral|7b/i,
    searchTerms: ['mistral', '7b'],
    excludeTerms: [],
    timeouts: {
      load: 120000,
      generate: 30000,
    },
    extraLogPatterns: ['embed', 'BF16', 'buffer', 'maxBuffer', 'gather', 'multi-shard', 'chunked'],
    headless: false,
  },
};

// ============================================
// Default Test Prompt
// ============================================

export const DEFAULT_PROMPT = 'Hello world';

// ============================================
// Token Quality Validation
// ============================================

/**
 * Good tokens expected for English "sky" prompts.
 * Finding these indicates the model is producing coherent output.
 */
export const GOOD_TOKENS = [
  'blue', 'clear', 'beautiful', 'vast', 'dark', 'night', 'bright',
  'color', 'sky', 'The', 'is', 'a', 'the', 'usually', 'often',
  'cloudy', 'typically', 'day',
];

/**
 * Bad tokens that indicate model/dequantization issues.
 * Non-English text or placeholder tokens suggest problems.
 */
export const BAD_TOKENS = [
  'thức',      // Vietnamese
  ')}"',       // Symbol sequence
  'už',        // Czech/Slovak
  '<unused',   // Placeholder tokens
  'unused>',
  'మా',        // Telugu
  'ನ',         // Kannada
  'ക',         // Malayalam
  '്',         // Malayalam virama
  '(?!',       // Regex pattern (corruption)
];

export interface TokenAnalysis {
  hasGood: boolean;
  hasBad: boolean;
  goodFound: string[];
  badFound: string[];
}

export interface AnalyzeTokensOptions {
  goodTokens?: string[];
  badTokens?: string[];
}

/**
 * Analyze text for token quality
 * @param text - Text to analyze
 * @param options - Override token lists
 * @returns Token analysis results
 */
export function analyzeTokens(text: string, options: AnalyzeTokensOptions = {}): TokenAnalysis {
  const goodTokens = options.goodTokens || GOOD_TOKENS;
  const badTokens = options.badTokens || BAD_TOKENS;

  const goodFound = goodTokens.filter(t =>
    text.toLowerCase().includes(t.toLowerCase())
  );

  const badFound = badTokens.filter(t => text.includes(t));

  return {
    hasGood: goodFound.length > 0,
    hasBad: badFound.length > 0,
    goodFound,
    badFound,
  };
}

// ============================================
// Log Patterns
// ============================================

/**
 * Base patterns for important logs (always included)
 */
export const BASE_LOG_PATTERNS = [
  'Prefill logits:',
  'Decode[',
  'OUTPUT',
  'Generated',
  'top-5:',
  '[Pipeline]',
  '[DOPPLERDemo]',
  '[DopplerLoader]',
  '[DEBUG]',
  '[Benchmark]',  // Performance metrics
  '[UnifiedDetect]',  // Memory detection debug
  'Loading model',
  'Model loaded',
  'Error',
  'ERROR',
  'from browser',
  'cached',
  '[BF16ToF32]',  // Debug: BF16 conversion
  '[BF16→F32',  // Debug: BF16 conversion
  '[_convertBF16',  // Debug: BF16 conversion
  'Checking',  // Debug
  'Creating staging',  // Debug
  '[ATT]',  // Attention debug
  '[ATT_DEBUG]',  // Attention debug
  '[ATT_PARAMS]',  // Attention debug
  '[Attention]',  // Attention debug
  '[Decode]',  // Decode step debug
  'Copying',  // Debug
  'Mapping staging',  // Debug
  'Reading data',  // Debug
  'INPUT CHECK',  // Debug: BF16 input verification
  'Dispatching',  // Debug: workgroup dispatch
  'Pipeline created',  // Debug: pipeline creation
  'BindGroup',  // Debug: bind group creation
  'GPU work',  // Debug: GPU sync
  'After layer',  // Debug: layer output check
  'LAYER_LOOP',  // Debug: layer processing
  'FINAL_HIDDEN',  // Debug: final hidden state check
  'LOOP_DONE',  // Debug: layer loop done
  'LAYER_ROUTE',  // Debug: layer routing
  'LAYER_GPU',  // Debug: GPU layer entry
  'LAYER_DEBUG',  // Debug: layer debug output
];

/**
 * Get all log patterns for a model
 * @param modelKey - Key from MODELS
 * @returns Array of log patterns
 */
export function getLogPatterns(modelKey: string): string[] {
  const model = MODELS[modelKey];
  if (!model) return BASE_LOG_PATTERNS;
  return [...BASE_LOG_PATTERNS, ...model.extraLogPatterns];
}

/**
 * Check if a log message is important
 * @param text - Log text
 * @param patterns - Patterns to check
 * @returns Whether the log is important
 */
export function isImportantLog(text: string, patterns: string[] = BASE_LOG_PATTERNS): boolean {
  return patterns.some(p => text.includes(p));
}

// ============================================
// Test Result Formatting
// ============================================

export interface TestResults {
  modelName: string;
  mode: string;
  loaded: boolean;
  generated: boolean;
  output: string;
  tokenAnalysis: TokenAnalysis | null;
  elapsed: number;
  errors: string[];
}

/**
 * Format test results for console output
 * @param results - Test results object
 * @returns Formatted result string
 */
export function formatResults(results: TestResults): string {
  const lines: string[] = [];
  const sep = '='.repeat(60);
  const dash = '-'.repeat(40);

  lines.push(sep);
  lines.push(`TEST RESULTS: ${results.modelName} (${results.mode} mode)`);
  lines.push(sep);

  lines.push(`Model loaded: ${results.loaded ? 'YES' : 'NO'}`);
  lines.push(`Generation complete: ${results.generated ? 'YES' : 'NO'}`);

  if (results.output) {
    lines.push(`\nOutput: ${results.output.slice(0, 200)}`);
  }

  if (results.tokenAnalysis) {
    lines.push(`\nToken analysis:`);
    lines.push(`  Good tokens: ${results.tokenAnalysis.goodFound.join(', ') || 'none'}`);
    lines.push(`  Bad tokens: ${results.tokenAnalysis.badFound.join(', ') || 'none'}`);
  }

  if (results.elapsed) {
    lines.push(`\nElapsed: ${results.elapsed}ms`);
  }

  lines.push(dash);

  if (results.errors?.length > 0) {
    lines.push('STATUS: FAIL - Errors occurred');
    results.errors.forEach(e => lines.push(`  ${e}`));
  } else if (results.tokenAnalysis?.hasBad) {
    lines.push('STATUS: FAIL - Producing garbage tokens');
  } else if (results.tokenAnalysis?.hasGood) {
    lines.push('STATUS: PASS - Producing coherent tokens');
  } else if (!results.generated) {
    lines.push('STATUS: FAIL - No generation output');
  } else {
    lines.push('STATUS: UNKNOWN - Check logs above');
  }

  lines.push(dash);

  return lines.join('\n');
}

// ============================================
// CLI Argument Parsing
// ============================================

export interface ParsedArgs {
  model: string;
  mode: string;
  prompt: string;
  headless: boolean | null;
  inspectTime: number;
  help: boolean;
}

/**
 * Parse CLI arguments for test runner
 * @param args - process.argv.slice(2)
 * @returns Parsed arguments
 */
export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    model: 'gemma',
    mode: 'direct',
    prompt: DEFAULT_PROMPT,
    headless: null, // null = use model default
    inspectTime: 0,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--model' || arg === '-m') {
      result.model = args[++i];
    } else if (arg === '--mode') {
      result.mode = args[++i];
    } else if (arg === '--demo') {
      result.mode = 'demo';
    } else if (arg === '--direct') {
      result.mode = 'direct';
    } else if (arg === '--prompt' || arg === '-p') {
      result.prompt = args[++i];
    } else if (arg === '--headless') {
      result.headless = true;
    } else if (arg === '--headed') {
      result.headless = false;
    } else if (arg === '--inspect' || arg === '-i') {
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        result.inspectTime = parseInt(next, 10);
        i++;
      } else {
        result.inspectTime = 10000; // default 10s
      }
    } else if (!arg.startsWith('-') && !result.model) {
      // Positional: model name
      result.model = arg;
    }
  }

  return result;
}

/**
 * Print help text
 */
export function printHelp(): void {
  console.log(`
Unified Model Test Runner

Usage: node test-runner.js [model] [options]

Models:
  gemma     Gemma 3 1B (default)
  mistral   Mistral 7B
  gptoss    GPT-OSS 20B
  embed     Mistral 7B with embedding diagnostics

Options:
  --mode <mode>   Test mode: 'direct' (minimal) or 'demo' (UI)
  --direct        Shorthand for --mode direct (default)
  --demo          Shorthand for --mode demo
  --prompt <text> Custom prompt (default: "${DEFAULT_PROMPT}")
  --headless      Run browser in headless mode
  --headed        Run browser with visible window
  -i, --inspect [ms]  Keep browser open for inspection (default: 10000ms)
  -h, --help      Show this help

Examples:
  node test-runner.js gemma --direct
  node test-runner.js mistral --demo --headed
  node test-runner.js gptoss --inspect 30000
`);
}
