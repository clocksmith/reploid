#!/usr/bin/env npx tsx
/**
 * REPLOID CLI - Unified testing, benchmarking, and debugging
 *
 * Usage:
 *   npx tsx tools/reploid-cli.ts <command> [options]
 *
 * Commands:
 *   test [suite]     Run tests (unit, integration, e2e, full)
 *   bench            Run benchmarks
 *   debug [options]  Interactive debug mode
 *   start            Start dev server
 *
 * Examples:
 *   reploid test                    # Run all tests
 *   reploid test --unit             # Unit tests only
 *   reploid test --e2e --headed     # E2E with visible browser
 *   reploid bench                   # Run benchmarks
 *   reploid debug --goal chat       # Debug specific goal
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// CLI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(msg: string, color = '') {
  console.log(`${color}${msg}${colors.reset}`);
}

function header(title: string) {
  const line = '='.repeat(60);
  log(`\n${line}`, colors.cyan);
  log(`  ${title}`, colors.bright + colors.cyan);
  log(`${line}\n`, colors.cyan);
}

type Command = 'test' | 'bench' | 'debug' | 'start';

interface CLIOptions {
  command: Command;
  suite: 'unit' | 'integration' | 'e2e' | 'full' | null;
  headed: boolean;
  verbose: boolean;
  filter: string | null;
  goal: string | null;
  watch: boolean;
  coverage: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CLIOptions {
  const opts: CLIOptions = {
    command: 'test',
    suite: null,
    headed: false,
    verbose: false,
    filter: null,
    goal: null,
    watch: false,
    coverage: false,
    help: false,
  };

  const tokens = [...argv];
  let positionalIndex = 0;

  while (tokens.length) {
    const arg = tokens.shift()!;
    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--headed':
        opts.headed = true;
        break;
      case '--headless':
        opts.headed = false;
        break;
      case '--unit':
        opts.suite = 'unit';
        break;
      case '--integration':
        opts.suite = 'integration';
        break;
      case '--e2e':
        opts.suite = 'e2e';
        break;
      case '--full':
        opts.suite = 'full';
        break;
      case '--filter':
      case '-f':
        opts.filter = tokens.shift() || null;
        break;
      case '--goal':
      case '-g':
        opts.goal = tokens.shift() || null;
        break;
      case '--watch':
      case '-w':
        opts.watch = true;
        break;
      case '--coverage':
        opts.coverage = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          if (positionalIndex === 0) {
            if (['test', 'bench', 'debug', 'start'].includes(arg)) {
              opts.command = arg as Command;
            } else {
              opts.suite = arg as CLIOptions['suite'];
            }
          } else if (positionalIndex === 1) {
            opts.suite = arg as CLIOptions['suite'];
          }
          positionalIndex++;
        }
        break;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
${colors.bright}REPLOID CLI - Test, Benchmark, Debug${colors.reset}

Three commands, three purposes:

  reploid test   ->  Correctness (does it work?)
  reploid bench  ->  Performance (how fast?)
  reploid debug  ->  Debugging (why is it broken?)

${colors.cyan}TEST - Correctness Tests${colors.reset}
  reploid test                  Run all tests
  reploid test --unit           Unit tests only
  reploid test --integration    Integration tests
  reploid test --e2e            Playwright E2E tests
  reploid test --full           All test suites
  reploid test --filter <name>  Filter tests by name
  reploid test --watch          Watch mode
  reploid test --coverage       With coverage report

${colors.cyan}BENCH - Performance Benchmarks${colors.reset}
  reploid bench                 Run performance benchmarks

${colors.cyan}DEBUG - Interactive Debugging${colors.reset}
  reploid debug                 Start debug console
  reploid debug --goal <name>   Debug specific goal
  reploid debug --headed        Show browser window

${colors.cyan}START - Development Server${colors.reset}
  reploid start                 Start dev server

${colors.cyan}Common Options:${colors.reset}
  --verbose, -v    Verbose output
  --help, -h       Show this help

${colors.cyan}Examples:${colors.reset}
  ${colors.dim}# Run unit tests${colors.reset}
  reploid test --unit

  ${colors.dim}# Run E2E tests with visible browser${colors.reset}
  reploid test --e2e --headed

  ${colors.dim}# Debug with specific goal${colors.reset}
  reploid debug --goal "write hello world"

  ${colors.dim}# Watch mode for TDD${colors.reset}
  reploid test --watch
`);
}

function runCommand(
  cmd: string,
  args: string[],
  options: SpawnOptions = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
      ...options,
    });

    proc.on('close', (code) => resolve(code ?? 0));
    proc.on('error', reject);
  });
}

async function runTests(opts: CLIOptions): Promise<number> {
  header('REPLOID TESTS');

  const args: string[] = [];

  // Handle E2E separately (uses Playwright)
  if (opts.suite === 'e2e') {
    log('Running E2E tests with Playwright...', colors.cyan);
    const playwrightArgs = ['playwright', 'test', 'tests/e2e'];
    if (opts.headed) {
      playwrightArgs.push('--headed');
    }
    if (opts.verbose) {
      playwrightArgs.push('--debug');
    }
    return runCommand('npx', playwrightArgs);
  }

  // Vitest for unit/integration tests
  args.push('vitest');

  if (!opts.watch) {
    args.push('run');
  }

  // Add test path based on suite
  if (opts.suite === 'unit') {
    args.push('tests/unit');
  } else if (opts.suite === 'integration') {
    args.push('tests/integration');
  } else if (opts.suite === 'full') {
    // Run all including E2E
    log('Running full test suite (unit + integration + e2e)...', colors.cyan);
    const vitestCode = await runCommand('npx', ['vitest', 'run']);
    if (vitestCode !== 0) return vitestCode;
    const playwrightArgs = ['playwright', 'test', 'tests/e2e'];
    if (opts.headed) playwrightArgs.push('--headed');
    return runCommand('npx', playwrightArgs);
  }

  if (opts.filter) {
    args.push('-t', opts.filter);
  }

  if (opts.coverage) {
    args.push('--coverage');
  }

  log(`Running: npx ${args.join(' ')}`, colors.dim);
  return runCommand('npx', args);
}

async function runBench(opts: CLIOptions): Promise<number> {
  header('REPLOID BENCHMARKS');

  // Check if benchmark file exists
  const benchPath = join(PROJECT_ROOT, 'tests/benchmarks');

  log('Running performance benchmarks...', colors.cyan);

  const args = ['vitest', 'bench'];
  if (opts.filter) {
    args.push('-t', opts.filter);
  }

  return runCommand('npx', args);
}

async function runDebug(opts: CLIOptions): Promise<number> {
  header('REPLOID DEBUG MODE');

  log('Starting debug console...', colors.cyan);
  if (opts.goal) {
    log(`Goal: ${opts.goal}`, colors.yellow);
  }
  if (opts.headed) {
    log('Browser: headed (visible)', colors.yellow);
  }

  // Use the E2E debug console
  const args = ['playwright', 'test', 'tests/e2e/debug-console.js'];

  if (opts.headed) {
    args.push('--headed');
  }

  // Pass goal via environment
  const env = { ...process.env };
  if (opts.goal) {
    env.REPLOID_DEBUG_GOAL = opts.goal;
  }

  return runCommand('npx', args, { env });
}

async function runStart(opts: CLIOptions): Promise<number> {
  header('REPLOID DEV SERVER');

  log('Starting development server...', colors.cyan);
  log('Open http://localhost:3000 in your browser', colors.green);

  return runCommand('node', ['server.js']);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let exitCode = 0;

  switch (opts.command) {
    case 'test':
      exitCode = await runTests(opts);
      break;
    case 'bench':
      exitCode = await runBench(opts);
      break;
    case 'debug':
      exitCode = await runDebug(opts);
      break;
    case 'start':
      exitCode = await runStart(opts);
      break;
    default:
      log(`Unknown command: ${opts.command}`, colors.red);
      printHelp();
      exitCode = 1;
  }

  process.exit(exitCode);
}

main();
