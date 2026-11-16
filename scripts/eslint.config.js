import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLayerViolations } from './verify-layers.js';
import { SERVER_LIBRARY_BOUNDARY } from './server-library-imports.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverLibraryRule = {
  meta: { type: 'problem', schema: [] },
  create(context) {
    const check = node => {
      const target = node.source;
      const specifier = target?.value ?? (target?.type === 'TemplateLiteral' && !target.expressions.length ? target.quasis[0].value.cooked : null);
      if (typeof specifier !== 'string') return;
      const violations = findLayerViolations({ repoRoot, sourcePath: context.filename, source: '', edges: [{ specifier }] });
      for (const row of violations.filter(value => value.reason === SERVER_LIBRARY_BOUNDARY)) {
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
  'verify-document-search', 'verify-gpu-startup', 'verify-peer-pack-execution',
  'verify-poolday-forecast-sdk', 'verify-swarm-runtime',
  'verify-visual-change-passport-dogfood'].map(name => `scripts/${name}.js`);
const cleanedModules = [
  'apps/poolday/host/private-computers.js',
  'apps/poolday/ui/pool-home/network-controls.js',
  'apps/poolday/ui/pool-home/network-inspector.js',
  'apps/poolday/providers/work-{adapter,provider,generation-completion}.js',
  'packages/reploid/src/adapters/{resident-execution,device-lane,model-adapter}.js',
  'server/{browser-module-references,native-resident-provider,native-whole-model}.js',
  'shared/infrastructure/{scoped-model-provider,generation-completion}.js',
  'scripts/{lint-changed-code,verify-layers,verify-browser-boundaries}.js',
  'apps/poolday/providers/work-device.js',
  'apps/poolday/providers/work-resident-provider.js',
  'server/fleet/placement.js',
  'packages/reploid/src/mesh/generation-context-cache.js',
  'server/native-model-config.js',
  'packages/reploid/src/mesh/computer-identity.js',
  'packages/reploid/src/mesh/gpu-signature.js',
  'packages/reploid/src/mesh/gpu-signature-shader.js',
  'apps/poolday/host/contribution-resume.js',
  'apps/poolday/host/device-capability.js',
  'apps/poolday/host/model-artifact-probe.js',
  'apps/poolday/host/peer-execution-config.js',
  'apps/poolday/host/peer-run-session.js',
  'apps/poolday/host/provider-contribution-session.js',
  'apps/poolday/ui/pool-home/controls.js',
  'apps/poolday/ui/pool-home/view.js',
  // Modules split out of controls.js and view.js keep the cleaned rules.
  'apps/poolday/ui/pool-home/control-display-text.js',
  'apps/poolday/ui/pool-home/room-activity-controls.js',
  'apps/poolday/ui/pool-home/sequence-consent.js',
  'apps/poolday/ui/pool-home/pending-request-recovery.js',
  'apps/poolday/ui/pool-home/page-identity.js',
  'apps/poolday/ui/pool-home/participation-state-view.js',
  'apps/poolday/ui/pool-home/participation-controls.js',
  'apps/poolday/ui/pool-home/capability-controls.js',
  'apps/poolday/ui/pool-home/dashboard-controls.js',
  'apps/poolday/ui/pool-home/peer-run-surface.js',
  'apps/poolday/ui/pool-home/run-controls.js',
  'apps/poolday/ui/pool-home/home-ask-controls.js',
  'apps/poolday/ui/pool-home/provider-controls.js',
  'apps/poolday/ui/pool-home/record-controls.js',
  'apps/poolday/ui/pool-home/view-markup.js',
  'apps/poolday/ui/pool-home/research-room-route.js',
  'apps/poolday/ui/pool-home/run-visual-state.js',
  'apps/poolday/ui/pool-home/record-ledger-view.js',
  'apps/poolday/ui/pool-home/provider-status-view.js',
  'apps/poolday/ui/pool-home/run-result-format.js',
  'apps/poolday/ui/pool-home/run-contribution-evidence.js',
  'apps/poolday/ui/pool-home/run-result-view.js',
  'apps/poolday/ui/pool-home/contribution-status-view.js',
  'apps/poolday/ui/pool-home/route-controls.js',
  'apps/poolday/ui/pool-home/examples-view.js',
  'apps/poolday/ui/pool-home/route-detail-view.js',
  'packages/reploid/src/mesh/partitions/preparation-owner.js',
  'packages/reploid/src/transport/sdp-fingerprint.js',
  'self/core/runtime-mode.js',
  'server/http-request-owner.js',
  'server/pool/relay.js',
  'server/proxy*.js',
  'tests/fixtures/installed-package-identity.js',
  'tests/fixtures/qwen-partition-control.js',
  'tests/fixtures/qwen-partition-cross-host.js',
  'tests/fixtures/qwen-partition-worker.js',
  'self/providers/external-brain.js',
  'server/external-brain.js',
  'packages/reploid/src/training/**/*.js',
  'apps/poolday/host/lora-training*.js',
  'apps/poolday/ui/pool-home/lora-training.js',
  'self/capabilities/cognition/vector-math.js',
  'self/capabilities/cognition/jsonl.js',
  'packages/reploid/src/artifacts/binary.js',
  'self/shared/change-passport/policy.js',
  'apps/poolday/pool/policy-router.js',
  'shared/pool/p2p-transport.js',
  'apps/poolday/pool/p2p-artifact-transfer.js',
  'shared/pool/inference-receipt.js',
  'shared/pool/config-contract.js',
  'apps/poolday/pool/requester-client.js',
  'apps/poolday/pool/complete-forecast.js',
  'self/infrastructure/browser-apis.js',
  'self/core/zero-prompt.js',
  'self/core/worker-agent.js',
  'self/core/vfs-module-loader.js',
  'self/core/security-config.js',
  'self/core/memory-manager.js',
  'self/capabilities/reflection/reflection-analyzer.js',
  'self/capabilities/cognition/symbolic/knowledge-graph.js',
  'self/capabilities/cognition/semantic/semantic-memory-llm.js',
  'self/capabilities/cognition/semantic/embedding-store.js',
  'self/capabilities/cognition/knowledge-tree.js',
  'self/capabilities/cognition/episodic-memory.js',
  'packages/reploid/src/transport/swarm.js',
  'packages/reploid/src/transport/room.js',
  'packages/reploid/src/transport/introduction-records.js',
  'packages/reploid/src/transport/assignment.js',
  'packages/reploid/src/retrieval/page-text.js',
  'packages/reploid/src/artifacts/signatures.js',
  'packages/reploid/src/artifacts/identity.js',
  'packages/reploid/src/agent/lab-strategy.js',
  'packages/reploid/src/agent/lab-strategy-*.js',
  'packages/reploid/src/artifacts/acceptance.js',
  'packages/reploid/src/artifacts/manifest-identity.js',
  'packages/reploid/src/agent/tool-operation-retry.js',
  'self/host/file-access.js',
  'shared/ui/components/html.js',
  'self/ui/components/vfs-progress.js',
  'self/host/reploid-launch.js',
  'self/ui/boot-wizard/connection-tests.js',
  'self/core/tool-argument-validation.js',
  'packages/reploid/src/artifacts/event-signature.js',
  'server/input-validation.js',
  'server/token-auth.js',
  'server/pool/routes/assignment-entry.js',
  'packages/reploid/src/chat/scheduler.js',
  'apps/poolday/host/chat-execution.js',
  'apps/poolday/host/computer-preferences.js',
  'apps/poolday/ui/pool-home/computer-preferences-view.js',
  'server/pool/routes.js',
  'server/pool/routes/receipts.js',
  'server/pool/store.js',
  'server/pool/firebase-store.js',
  'server/pool/services/acceptance.js',
  'server/pool/services/acceptance-settlement.js',
  'server/pool/reputation.js',
  'server/pool/verifier.js',
  'server/pool/coordinator-transitions.js',
  'server/pool/store-contract.js'
];

export default [
  { ignores: ['.cache/**', '.tmp/**', '.claude/worktrees/**', '.deployment-checkouts/**',
    'output/**', 'node_modules/**', 'artifacts/**', 'coverage/**', 'test-results/**', 'playwright-report/**',
    'shared/vendor/**', 'self/core/vendor/**', 'shared/core/vendor/**', '**/dist/**', 'packages/poolday-forecast/source/**', 'apps/poolday/ui/pool-home/app.bundle.js',
    'self/lib/**', 'doppler/**', '.firebase-hosting/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-undef': 'error',
      'no-restricted-globals': ['error', 'parent', 'name', 'event'], 'no-unreachable': 'error', 'no-dupe-args': 'error',
      'no-dupe-keys': 'error', 'no-constant-binary-expression': 'error', 'valid-typeof': 'error' }
  },
  { files: ['self/**/*.js', 'shared/**/*.js', 'apps/poolday/**/*.js', 'examples/library-consumer/**/*.js',
    'docs/diagrams/reploid-diagram/source/**'], ignores: workerFiles, languageOptions: { globals: globals.browser } },
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
    'docs/diagrams/reploid-diagram/test/**/*.mjs', 'docs/status/**/verify.js',
    'reports/local/**/native-control.js'],
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
    'shared/pool/device-identity.js', 'apps/poolday/pool/p2p-artifact-transfer.js',
    'packages/reploid/src/artifacts/binary.js',
    'self/bridge.js', 'self/tools/ReadFile.js', 'self/tools/WriteFile.js', 'self/key-unsealer.js'],
    languageOptions: { globals: { Buffer: 'readonly' } } },
  // Vitest uses happy-dom; Node globals are intentional only in the test host.
  { files: ['tests/**/*.js', 'tests/**/*.mjs'], languageOptions: { globals: { ...globals.vitest, ...globals.browser, ...globals.node } } },
  { files: ['apps/poolday/host/private-computers.js',
    'packages/reploid/src/adapters/{resident-execution,device-lane,model-adapter}.js',
    'server/{native-resident-provider,native-whole-model}.js',
    'shared/infrastructure/scoped-model-provider.js'], rules: { 'no-nested-ternary': 'error' } },
  { files: cleanedModules, rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] } }
];
