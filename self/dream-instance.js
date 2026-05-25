/**
 * @fileoverview Dream instance manifest contract for browser RGR orchestration.
 */

import { getCurrentReploidInstanceId } from './instance.js';

export const DREAM_INSTANCE_SCHEMA = 'reploid/dream-instance/v1';
export const DEFAULT_DREAM_INSTANCE_ID = 'dream-default';
export const DREAM_INSTANCE_MANIFEST_PATH = '/self/instances/dream/default.instance.json';
export const DREAM_INSTANCE_SOURCE_PATH = '/self/dream-instance.js';
export const DREAM_INSTANCE_ARTIFACT_ROOT = '/artifacts/dream';

const clone = (value) => JSON.parse(JSON.stringify(value));

const DREAM_RUNTIME_PIPELINE = Object.freeze([
  'situation_frame',
  'intent_ingestion',
  'task_contract',
  'concept_graph',
  'selection_priors',
  'composition_graph',
  'experience_graph',
  'ui_graph',
  'effects_graph',
  'policy_check',
  'receipt_bound_dispatch',
  'hydration'
]);

const DREAM_TRAINING_STAGES = Object.freeze([
  {
    id: 'ui_compose',
    trains: 'ui-composer-diffusion-v0',
    gate: 'gate:ui-composer'
  },
  {
    id: 'concept_decomposition',
    trains: 'concept-graph-decomposer-v0',
    gate: 'gate:concept-graph'
  },
  {
    id: 'ui_energy',
    trains: 'ui-ebrm-diffusion-v0/v1',
    gate: 'gate:ui-rendered-quality or gate:ui-ebrm-trainer-acceptance'
  },
  {
    id: 'intent_projector',
    trains: 'intent-controls-task-contract-projector-v1',
    gate: 'gate:intent-projector'
  },
  {
    id: 'synthesis',
    trains: 'synthesis-mixer-diffusion-v0',
    gate: 'gate:synthesis-sensor'
  },
  {
    id: 'compose',
    trains: 'ebrm-diffusion-v0',
    gate: 'gate:ebrm-sensor and bench:ebrm:eval:diffusion'
  },
  {
    id: 'bridge',
    trains: 'd1-to2-bridge-diffusion-v0',
    gate: 'trainer report plus model-family verification'
  }
]);

const DREAM_COMPLETION_GATES = Object.freeze([
  'labels validate against schemas/teacher-label-result.json',
  'teacher export writes promoted training rows',
  'trainer accepts the promoted rows',
  'affected model retrains and emits a new artifact hash',
  'stage gate or benchmark passes',
  'asset map and model-family locks refresh from disk',
  'model lineage appends the artifact hash, corpus hash, metrics, and verifier results',
  'verify:assets, verify:model-families, verify:training, and npm test pass'
]);

const DREAM_BROWSER_LANES = Object.freeze([
  {
    id: 'manifest',
    substrate: 'VFS',
    role: 'hold the Dream instance contract and source provenance'
  },
  {
    id: 'queues',
    substrate: 'OPFS or VFS artifacts',
    role: 'stage teacher batches, primary queues, adjudication queues, and eval summaries'
  },
  {
    id: 'inference',
    substrate: 'local or peer host slots',
    role: 'serve Dream runtime stages and teacher/adjudicator calls'
  },
  {
    id: 'compute',
    substrate: 'workers and WebGPU when available',
    role: 'run small training, scoring, replay, and eval jobs'
  },
  {
    id: 'receipts',
    substrate: 'artifact receipts',
    role: 'anchor labels, gates, benchmarks, lineage, and promotion decisions'
  }
]);

const normalizeString = (value, fallback = '') => {
  const text = String(value || '').trim();
  return text || fallback;
};

export function getDreamInstanceSeedSummary() {
  return {
    id: DEFAULT_DREAM_INSTANCE_ID,
    kind: 'dream',
    state: 'manifested',
    mode: 'shadow',
    manifestPath: DREAM_INSTANCE_MANIFEST_PATH,
    sourcePath: DREAM_INSTANCE_SOURCE_PATH,
    artifactRoot: DREAM_INSTANCE_ARTIFACT_ROOT,
    stageCount: DREAM_TRAINING_STAGES.length,
    gate: 'anchored-promotion'
  };
}

export function buildDreamInstanceManifest(options = {}) {
  const reploidInstanceId = normalizeString(
    options.reploidInstanceId || options.instanceId || getCurrentReploidInstanceId(),
    'default'
  );
  const dreamInstanceId = normalizeString(options.dreamInstanceId, DEFAULT_DREAM_INSTANCE_ID);
  const goal = normalizeString(options.goal, 'Manifest Dream as a browser-governed training and eval instance.');
  const environment = normalizeString(options.environment, 'browser');
  const swarmEnabled = !!options.swarmEnabled;
  const hasInference = !!options.hasInference;

  return {
    schema: DREAM_INSTANCE_SCHEMA,
    version: 1,
    id: dreamInstanceId,
    kind: 'dream',
    title: 'Dream browser training and eval instance',
    state: 'manifested',
    mode: 'shadow',
    reploidInstanceId,
    manifestPath: DREAM_INSTANCE_MANIFEST_PATH,
    sourcePath: DREAM_INSTANCE_SOURCE_PATH,
    artifactRoot: DREAM_INSTANCE_ARTIFACT_ROOT,
    objective: goal,
    environment,
    relationshipToReploid: {
      role: 'RGR-managed browser instance',
      boundary: 'Reploid coordinates queues, candidates, evals, receipts, and promotion. Dream runtime invariants remain authoritative.',
      productClaim: 'Dream can be manifested, trained, evolved, evaled, and improved through browser-governed jobs when the required queues, validators, artifacts, and gates are present.',
      nonClaim: 'This does not claim frontier-scale model retraining, large corpus distillation, or self-approved evaluator mutation is browser-only.'
    },
    boot: {
      appearsIn: [
        '/self/self.json',
        DREAM_INSTANCE_MANIFEST_PATH
      ],
      readFirst: [
        DREAM_INSTANCE_MANIFEST_PATH,
        '/self/blueprints/rgr-dream-instance-manifest.md',
        '/self/prompts/kernel.md',
        '/self/blueprints/0x000112-recursive-gepa-ring.md',
        '/self/blueprints/rgr-slot-topology.md'
      ],
      launch: {
        swarmEnabled,
        hasInference,
        runnable: hasInference || swarmEnabled,
        executorPolicy: hasInference
          ? (swarmEnabled ? 'local host plus peer slots' : 'local host')
          : (swarmEnabled ? 'wait for peer host slots' : 'manifest only')
      }
    },
    runtimeContract: {
      sourceRepo: 'dream',
      docs: [
        'docs/how-it-works.md',
        'docs/training.md',
        'docs/teacher-distillation.md',
        'docs/experience-graphs.md',
        'docs/status.md'
      ],
      pipeline: clone(DREAM_RUNTIME_PIPELINE),
      invariant: 'Composition Graph to Effects Graph to policy check to receipt-bound dispatch remains deterministic.'
    },
    trainingContract: {
      stagePriority: clone(DREAM_TRAINING_STAGES),
      queueRoot: 'assets/training/teacher-distillation',
      completionGates: clone(DREAM_COMPLETION_GATES),
      authority: 'Teacher labels are incomplete until validation, export, trainer acceptance, retraining, gate or benchmark, lock refresh, lineage, and verification complete.'
    },
    browserSubstrate: {
      lanes: clone(DREAM_BROWSER_LANES),
      storage: [
        'VFS for manifests and source contracts',
        'OPFS for larger queue, checkpoint, replay, and eval artifacts',
        'content-addressed receipts under /artifacts/dream'
      ],
      compute: [
        'workers for queue validation, replay, and score aggregation',
        'WebGPU for small train/eval kernels when available',
        'peer slots for teacher, adjudicator, witness, and evaluator lanes'
      ]
    },
    promotionGate: {
      state: 'blocked',
      reason: 'Dream candidates stay in Shadow until anchored evidence proves the new artifact, corpus, metrics, locks, lineage, and verifier results.',
      anchors: [
        'validated labels',
        'frozen export',
        'trainer report',
        'stage gate or benchmark',
        'asset map and model-family locks',
        'append-only lineage',
        'verification receipt'
      ],
      evaluatorMutationPolicy: 'Evaluator changes require quarantine and independent replay. A candidate cannot approve its own judge.'
    },
    artifactLayout: {
      queues: `${DREAM_INSTANCE_ARTIFACT_ROOT}/queues`,
      labels: `${DREAM_INSTANCE_ARTIFACT_ROOT}/labels`,
      evals: `${DREAM_INSTANCE_ARTIFACT_ROOT}/evals`,
      receipts: `${DREAM_INSTANCE_ARTIFACT_ROOT}/receipts`,
      lineage: `${DREAM_INSTANCE_ARTIFACT_ROOT}/lineage`,
      promotions: `${DREAM_INSTANCE_ARTIFACT_ROOT}/promotions`
    }
  };
}

export function buildDreamInstanceFiles(options = {}) {
  return {
    [DREAM_INSTANCE_MANIFEST_PATH]: JSON.stringify(buildDreamInstanceManifest(options), null, 2)
  };
}

export function listDreamInstanceSeedPaths() {
  return [
    DREAM_INSTANCE_MANIFEST_PATH
  ];
}

export default {
  DEFAULT_DREAM_INSTANCE_ID,
  DREAM_INSTANCE_ARTIFACT_ROOT,
  DREAM_INSTANCE_MANIFEST_PATH,
  DREAM_INSTANCE_SCHEMA,
  DREAM_INSTANCE_SOURCE_PATH,
  buildDreamInstanceFiles,
  buildDreamInstanceManifest,
  getDreamInstanceSeedSummary,
  listDreamInstanceSeedPaths
};
