#!/usr/bin/env npx tsx
/**
 * REPLOID CLI - Unified testing, benchmarking, and debugging
 *
 * Usage:
 *   npx tsx bin/reploid-cli.ts <command> [options]
 *
 * Commands:
 *   test [suite]     Run tests (unit, integration, e2e, full)
 *   bench            Run benchmarks
 *   debug [options]  Interactive debug mode
 *   start            Start dev server
 *   signal           Start standalone signaling server
 *
 * Examples:
 *   reploid test                    # Run Vitest suites (no browser execution)
 *   reploid test --unit             # Unit tests only
 *   reploid test --e2e --headed     # E2E with visible browser
 *   reploid bench                   # Run benchmarks
 *   reploid debug --goal chat       # Debug specific goal
 */

import { spawn, type SpawnOptions } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
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

const commands = {
  test: 'Run Vitest suites; --full also runs Playwright',
  bench: 'Run performance benchmarks',
  debug: 'Open the browser debug console',
  start: 'Start the development server',
  signal: 'Start standalone WebRTC signaling',
};
export const proofCommands = {
  'peer-pack': { script: 'scripts/verify-peer-pack-execution.js', usage: '--config <path>', description: 'Physical-browser peer reconstruction and execution; requires an explicit GPU/model configuration' },
  'retain-peer-pack': { script: 'scripts/retain-peer-pack-execution.js', usage: '--report <path> --out <new-directory> --weight-origin <url> [--attachment <path>]', description: 'Retain a passed source-bound episode without overwriting historical evidence' },
};
type Command = keyof typeof commands;

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
  dryRun: boolean;
}

export function parseArgs(argv: string[]): CLIOptions {
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
    dryRun: false,
  };

  const tokens = [...argv];
  let positionalIndex = 0;
  const suite = (value: string) => {
    if (!['unit', 'integration', 'e2e', 'full'].includes(value)) throw new Error(`Unknown command or suite: ${value}`);
    if (opts.suite && opts.suite !== value) throw new Error('Choose one test suite');
    opts.suite = value as CLIOptions['suite'];
  };
  const requiredValue = (flag: string) => {
    const value = tokens.shift();
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
    return value;
  };

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
        suite('unit');
        break;
      case '--integration':
        suite('integration');
        break;
      case '--e2e':
        suite('e2e');
        break;
      case '--full':
        suite('full');
        break;
      case '--filter':
      case '-f':
        opts.filter = requiredValue(arg);
        break;
      case '--goal':
      case '-g':
        opts.goal = requiredValue(arg);
        break;
      case '--watch':
      case '-w':
        opts.watch = true;
        break;
      case '--coverage':
        opts.coverage = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      default:
        if (!arg.startsWith('-')) {
          if (positionalIndex === 0) {
            if (Object.hasOwn(commands, arg)) {
              opts.command = arg as Command;
            } else {
              suite(arg);
            }
          } else if (positionalIndex === 1) {
            suite(arg);
          } else throw new Error(`Unexpected argument: ${arg}`);
          positionalIndex++;
        } else throw new Error(`Unknown option: ${arg}`);
        break;
    }
  }

  if (opts.suite && opts.command !== 'test') throw new Error('Test suites apply only to test');
  if (opts.watch && ['e2e', 'full'].includes(opts.suite || '')) throw new Error('Watch mode applies only to Vitest suites');
  if (opts.coverage && opts.suite === 'e2e') throw new Error('Coverage applies only to Vitest suites');
  return opts;
}

function printHelp(): void {
  console.log(`
${colors.bright}REPLOID CLI - Test, Benchmark, Debug${colors.reset}

${Object.entries(commands).map(([name, description]) => `  reploid ${name.padEnd(8)} ${description}`).join('\n')}

${colors.cyan}TEST - Correctness Tests${colors.reset}
  reploid test                  Run Vitest suites (no browser execution)
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

${colors.cyan}SIGNAL - Local WebRTC Signaling${colors.reset}
  reploid signal                Start standalone signaling server

${colors.cyan}Common Options:${colors.reset}
  --verbose, -v    Verbose output
  --help, -h       Show this help
  --dry-run       Print the selected test or proof commands without executing

${colors.cyan}PROOF - Explicit physical execution and immutable retention${colors.reset}
${Object.entries(proofCommands).map(([name, command]) => `  reploid proof ${name} ${command.usage}\n    ${command.description}`).join('\n')}

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

    proc.on('close', (code) => resolve(code ?? 1));
    proc.on('error', reject);
  });
}

export function buildTestCommands(opts: CLIOptions): string[][] {
  const vitest = ['vitest', ...(!opts.watch ? ['run'] : [])];
  if (opts.suite === 'unit' || opts.suite === 'integration') vitest.push(`tests/${opts.suite}`);
  if (opts.filter) vitest.push('-t', opts.filter);
  if (opts.coverage) vitest.push('--coverage');
  if (opts.verbose) vitest.push('--reporter=verbose');
  const playwright = ['playwright', 'test', 'tests/e2e'];
  if (opts.headed) playwright.push('--headed');
  if (opts.filter) playwright.push('--grep', opts.filter);
  if (opts.verbose) playwright.push('--reporter=list');
  return opts.suite === 'e2e' ? [playwright] : opts.suite === 'full' ? [vitest, playwright] : [vitest];
}

async function runTests(opts: CLIOptions): Promise<number> {
  const selected = buildTestCommands(opts);
  if (opts.dryRun) { console.log(JSON.stringify(selected)); return 0; }
  header('REPLOID TESTS');
  for (const args of selected) {
    log(`Running: npx ${args.join(' ')}`, colors.dim);
    const code = await runCommand('npx', args);
    if (code !== 0) return code;
  }
  return 0;
}

export function buildProofCommand(argv: string[]): string[] {
  const [name, ...args] = argv;
  if (!Object.hasOwn(proofCommands, name)) throw new Error(`Unknown proof: ${name || 'missing'}`);
  const entry = proofCommands[name as keyof typeof proofCommands];
  return [entry.script, ...args.filter((arg) => arg !== '--dry-run')];
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
  header('REPLOID START');

  if (process.env.REPLOID_SKIP_CLOUD_ACCESS_BUILD === 'true') {
    log('Using existing sealed Reploid Cloud access windows.', colors.dim);
  } else {
    log('Provisioning sealed Reploid Cloud access windows...', colors.cyan);
    const buildCode = await runCommand('node', ['scripts/build-reploid-cloud-access.js']);
    if (buildCode !== 0) {
      return buildCode;
    }
  }

  log('Starting proxy server...', colors.cyan);
  log('Open http://localhost:8000 in your browser', colors.green);

  return runCommand('node', ['server/proxy.js']);
}

async function runSignal(): Promise<number> {
  header('REPLOID SIGNALING');
  log('Starting standalone signaling server...', colors.cyan);
  return runCommand('node', ['server/reploid-signaling.js']);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'proof') {
    if (argv.includes('--help') || argv.includes('-h')) { printHelp(); return; }
    const args = buildProofCommand(argv.slice(1));
    if (argv.includes('--dry-run')) { console.log(JSON.stringify(args)); return; }
    process.exitCode = await runCommand(process.execPath, args);
    return;
  }
  const opts = parseArgs(argv);

  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (opts.dryRun && opts.command !== 'test') throw new Error('--dry-run applies only to test and proof');

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
    case 'signal':
      exitCode = await runSignal();
      break;
    default:
      log(`Unknown command: ${opts.command}`, colors.red);
      printHelp();
      exitCode = 1;
  }

  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
