/**
 * @fileoverview Goal presets for the boot wizard.
 */

const TAGS = {
  UI: 'UI',
  VISUAL: 'Visualization',
  ORCH: 'Orchestration',
  BENCH: 'Benchmark',
  GOV: 'Governance',
  DATA: 'Data',
  SYS: 'Systems'
};

const GOAL_CATEGORIES = {
  'L0: Basic Functions': [
    {
      view: 'Katamari DOM sweep overlay',
      text: 'Create a katamari ball overlay that rolls across the live UI, absorbs smaller DOM elements, and grows until the interface is consumed.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    },
    {
      view: 'Cycle state summarizer',
      text: 'Build a cycle summarizer that writes 256, 64, 16, 4, and 1 word reports after each loop into /cyclesummaries/.',
      tags: [TAGS.DATA, TAGS.BENCH, TAGS.SYS]
    },
    {
      view: 'Snapshot capture tool',
      text: 'Create a snapshot tool that captures the live workspace and active canvases into /artifacts with timestamps and readable labels.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    }
  ],
  'L1: Meta Tooling': [
    {
      view: 'Scenario runner with seeds',
      text: 'Implement a seeded scenario runner that executes multiple goals, records outcomes, and outputs a compact score table.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Tool generator forge',
      text: 'Build a tool forge that turns a structured request into a new tool with schema, smoke test, and usage note.',
      tags: [TAGS.SYS, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Persona library editor',
      text: 'Create a persona library that stores named personas, switches the active persona, and records the impact on behavior.',
      tags: [TAGS.UI, TAGS.ORCH, TAGS.DATA]
    }
  ],
  'L2: Substrate': [
    {
      view: 'Three agent coordinator',
      text: 'Implement a three-agent coordinator that assigns roles, gathers independent outputs, and merges them into one decision packet.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.DATA]
    },
    {
      view: 'VFS integrity audit pipeline',
      text: 'Add a VFS integrity audit that hashes critical paths, detects drift, and writes a clear remediation report.',
      tags: [TAGS.GOV, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Iframe clone benchmark runner',
      text: 'Spawn an isolated UI clone, run the same task in both instances, and report latency, quality, and stability deltas.',
      tags: [TAGS.GOV, TAGS.SYS, TAGS.DATA]
    }
  ],
  'L3: Weak RSI': [
    {
      view: 'Core self-patch loop',
      text: 'Implement a bounded self-patch loop that diagnoses failures, edits /core/agent-loop.js, verifies in sandbox, and rolls back regressions.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Prompt kernel mutation gate',
      text: 'Enable controlled prompt-kernel mutations in /core/persona-manager.js, benchmark them, and keep only changes that improve results.',
      tags: [TAGS.ORCH, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Substrate regression harness',
      text: 'Build a substrate regression harness that replays fixed tasks against core edits, stores diffs, and auto-reverts failing changes.',
      tags: [TAGS.BENCH, TAGS.GOV, TAGS.SYS]
    }
  ],
  'L4: Theoretical RSI': [
    {
      view: 'Autonomous core self rewrite',
      text: 'Redesign, implement, test, and deploy a better agent core without human input, then safely repeat the loop.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Distilled reflection parity',
      text: 'Distill current behavior into a smaller reflection model, replace the runtime path, and preserve quality, safety, and measured progress.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Cross-reploid federation signal',
      text: 'Design a peer federation protocol with safe join, leave, audit, and shared-goal coordination between multiple Reploid instances.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    }
  ]
};

const normalizeText = (value) => String(value || '').trim();

export function getGoalCategories() {
  return GOAL_CATEGORIES;
}

export function findGoalMeta(goalValue) {
  const normalized = normalizeText(goalValue).toLowerCase();
  if (!normalized) return null;

  for (const [category, goals] of Object.entries(GOAL_CATEGORIES)) {
    for (const goal of goals) {
      const view = normalizeText(goal.view).toLowerCase();
      const text = normalizeText(goal.text).toLowerCase();
      if (view === normalized || text === normalized) {
        return { ...goal, category };
      }
    }
  }

  return null;
}

export function formatGoalPacket(goalValue) {
  const goal = normalizeText(goalValue);
  return goal ? goal : '';
}
