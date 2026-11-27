import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLayerViolations } from './verify-layers.js';
import { SERVER_LIBRARY_BOUNDARY, SERVER_LIBRARY_COPY } from './server-library-imports.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverLibraryRule = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const check = node => {
      const target = node.source;
      const specifier = target?.value ?? (target?.type === 'TemplateLiteral' && !target.expressions.length ? target.quasis[0].value.cooked : null);
      if (typeof specifier !== 'string') return;
      const violations = findLayerViolations({ repoRoot, sourcePath: context.filename, source: '', edges: [{ specifier }] });
      for (const row of violations.filter(value => value.reason === SERVER_LIBRARY_BOUNDARY || value.reason === SERVER_LIBRARY_COPY)) {
        context.report({ node: target, message: row.reason + ': ' + specifier });
      }
    };
    return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check };
  }
};

const workerFiles = ['shared/core/verification-worker.js', 'self/sw.js',
  'self/sw-module-loader.js', 'self/host/sw-module-loader.js', 'apps/poolday/host/lora-training-worker.js'];
// These Node harnesses execute serialized callbacks inside Playwright pages.
const browserHarnesses = ['evaluate-document-answers', 'pool-actual-browser-smoke',
  'pool-browser-smoke', 'verify-cloudflare-swarm', 'verify-deploy-surface',
  'verify-gpu-startup', 'verify-peer-pack-execution',
  'verify-swarm-runtime',
  'verify-visual-change-passport-dogfood'].map(name => `scripts/${name}.js`);
const cleanedFixtures = [
  'tests/fixtures/installed-package-identity.js',
  'tests/fixtures/qwen-partition-control.js',
  'tests/fixtures/qwen-partition-cross-host.js',
  'tests/fixtures/qwen-partition-worker.js'
];

export default [
  { ignores: ['.cache/**', '.tmp/**', '.claude/worktrees/**', '.deployment-checkouts/**',
    'output/**', 'node_modules/**', 'artifacts/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
    'shared/vendor/**', 'self/core/vendor/**', 'shared/core/vendor/**', '**/dist/**', 'packages/poolday-forecast/source/**', 'apps/poolday/ui/react/**',
    'self/lib/**', 'doppler/**', '.firebase-hosting/**',
    // The Flutter app is Dart; its build output is generated JavaScript.
    'apps/mobile/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-undef': 'error',
      'no-restricted-globals': ['error', 'parent', 'name', 'event'], 'no-unreachable': 'error', 'no-dupe-args': 'error',
      'no-dupe-keys': 'error', 'no-constant-binary-expression': 'error', 'valid-typeof': 'error' }
  },
  { files: ['self/**/*.js', 'shared/**/*.js', 'apps/poolday/**/*.js', 'examples/library-consumer/**/*.js',
    'docs/diagrams/reploid-diagram/source/**', 'server/daily/site/**/*.js'], ignores: workerFiles, languageOptions: { globals: globals.browser } },
  // Ownership boundaries for static imports; scripts/verify-browser-boundaries.js checks every reference form.
  { files: ['self/**/*.js'], rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: ['**/apps/poolday/**'], message: 'The substrate does not load Poolday product code.' }] }] } },
  { files: ['shared/**/*.js'], rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: ['**/self/**', '**/apps/**'], message: 'Shared browser code loads only shared code.' }] }] } },
  { files: ['apps/poolday/**/*.js'], rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: ['**/self/**'], message: 'Poolday loads the substrate only through its documented entry points (scripts/verify-browser-boundaries.js).' }] }] } },
  { files: ['server/**/*.js'], plugins: { architecture: { rules: { 'server-library-imports': serverLibraryRule } } },
    rules: { 'architecture/server-library-imports': 'error', 'no-restricted-imports': ['error', { patterns: [
    { group: ['**/apps/poolday/ui/**', '**/apps/poolday/styles/**', '**/apps/poolday/providers/**',
      '**/self/core/**', '**/self/ui/**', '**/self/tools/**', '**/self/capabilities/**'],
      message: 'Hosted services compose contracts and host adapters; presentation and substrate execution stay with their owners.' }] }] } },
  { files: workerFiles, languageOptions: { globals: { ...globals.worker, ...globals.serviceworker } } },
  { files: ['server/**/*.js', 'scripts/**/*.{js,mjs}', 'packages/reploid/src/**/*.js', 'apps/poolday/**/*.js', 'self/**/*.js', 'shared/**/*.js'],
    ignores: ['apps/poolday/config/doppler-metadata-contract.js'], rules: {
    'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }]
  } },
  { files: ['server/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs', 'tools/**/*.js', 'bin/**/*.js',
    'packages/functions/**/*.js', '.github/actions/**/*.js',
    'docs/diagrams/reploid-diagram/{build,server}.mjs',
    'docs/diagrams/reploid-diagram/test/**/*.mjs', 'docs/status/**/verify.js', 'docs/status/**/restore-capsule.js',
    'reports/local/**/native-control.js'], ignores: ['server/daily/site/**'],
    languageOptions: { globals: globals.node } },
  { files: browserHarnesses, languageOptions: { globals: globals.browser } },
  { files: ['scripts/verify-gpu-startup.js'],
    languageOptions: { globals: { GPUBufferUsage: 'readonly', GPUMapMode: 'readonly' } } },
  // Environment probe supports importing this adapter in Node tests.
  { files: ['self/core/vfs-module-loader.js'], languageOptions: { globals: { process: 'readonly' } } },
  { files: ['packages/reploid/src/**/*.js'], languageOptions: { globals: globals.worker } },
  { files: ['packages/reploid/src/mesh/gpu-signature.js'],
    languageOptions: { globals: { GPUBufferUsage: 'readonly', GPUMapMode: 'readonly' } } },
  // These codecs deliberately support optional Node Buffer and browser encodings.
  { files: ['packages/reploid/src/artifacts/identity.js', 'packages/reploid/src/artifacts/signatures.js',
    'shared/pool/device-identity.js',
    'packages/reploid/src/artifacts/binary.js',
    'self/bridge.js', 'self/tools/ReadFile.js', 'self/tools/WriteFile.js', 'self/key-unsealer.js'],
    languageOptions: { globals: { Buffer: 'readonly' } } },
  // Vitest uses happy-dom; Node globals are intentional only in the test host.
  { files: ['tests/**/*.js', 'tests/**/*.mjs'], languageOptions: { globals: { ...globals.vitest, ...globals.browser, ...globals.node } } },
  { files: ['apps/poolday/host/private-computers.js',
    'packages/reploid/src/adapters/{resident-execution,device-lane,model-adapter}.js',
    'server/{native-resident-provider,native-whole-model}.js',
    'shared/infrastructure/scoped-model-provider.js'], rules: { 'no-nested-ternary': 'error' } },
  { files: cleanedFixtures, rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] } }
];
