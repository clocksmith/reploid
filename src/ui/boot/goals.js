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
      view: 'Shader playground panel',
      text: 'Add a main area panel that renders a live GLSL shader preview with editable code and two slider inputs.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    },
    {
      view: 'Artifact gallery panel',
      text: 'Create a panel that previews the latest text and image artifacts from /artifacts with paging and open actions.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.DATA]
    },
    {
      view: 'Live log stream panel',
      text: 'Build a main area log stream with level filters and a pause button for slow inspection.',
      tags: [TAGS.UI, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'VFS quick search panel',
      text: 'Add a search panel that scans VFS paths and shows inline previews with copy path actions.',
      tags: [TAGS.UI, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Prompt ladder summarizer',
      text: 'Create a tool that summarizes input at 256, 128, 64, and 32 words and writes all versions to /artifacts for comparison.',
      tags: [TAGS.DATA, TAGS.BENCH, TAGS.SYS]
    },
    {
      view: 'Visual diff panel',
      text: 'Add a panel that compares two VFS files and highlights changed lines in a split view.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.DATA]
    },
    {
      view: 'Snapshot capture panel',
      text: 'Add a capture panel that stores DOM or canvas snapshots to /artifacts with a timestamped label.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    }
  ],
  'L1: Meta Tooling': [
    {
      view: 'Scenario runner with seeds',
      text: 'Implement a scenario runner that executes a list of goals with fixed seeds and produces a score table.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Tool smoke test harness',
      text: 'Build a tool smoke test runner with timeouts and a summary report saved to /artifacts.',
      tags: [TAGS.BENCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Persona library editor',
      text: 'Create a persona editor panel that stores named personas in VFS and lets users set the active persona.',
      tags: [TAGS.UI, TAGS.ORCH, TAGS.DATA]
    },
    {
      view: 'Panel registry manager',
      text: 'Implement a registry that lists all panels, toggles visibility, and persists layout in VFS.',
      tags: [TAGS.UI, TAGS.SYS, TAGS.DATA]
    },
    {
      view: 'Instance connector panel',
      text: 'Add a connector panel that tracks external endpoints, shows status, and stores configs in VFS for reuse.',
      tags: [TAGS.UI, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Manifest inspector panel',
      text: 'Build a manifest inspector that validates model config against schema and reports missing fields.',
      tags: [TAGS.UI, TAGS.GOV, TAGS.DATA]
    },
    {
      view: 'Replay and compare runner',
      text: 'Create a replay runner that reuses saved prompts, compares outputs, and logs diffs.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.GOV]
    }
  ],
  'L2: Substrate': [
    {
      view: 'Three agent coordinator',
      text: 'Implement a coordinator that spawns three personas, assigns roles, and merges output into one decision packet.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.DATA]
    },
    {
      view: 'Arena ledger and transcripts',
      text: 'Create an arena ledger that records debate rounds, votes, and outcomes in VFS with deterministic ordering.',
      tags: [TAGS.ORCH, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'VFS integrity audit pipeline',
      text: 'Add a pipeline that hashes critical VFS paths on milestones and reports drift.',
      tags: [TAGS.GOV, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Module gate visualizer',
      text: 'Build a panel that visualizes module gates, active status, and missing dependencies.',
      tags: [TAGS.UI, TAGS.GOV, TAGS.DATA]
    },
    {
      view: 'Instance VFS sync bridge',
      text: 'Implement push and pull sync for selected VFS paths to a remote instance with conflict notes.',
      tags: [TAGS.GOV, TAGS.SYS, TAGS.DATA]
    },
    {
      view: 'Hot reload with rollback',
      text: 'Create a hot reload flow that verifies modules, then rolls back automatically on failure.',
      tags: [TAGS.GOV, TAGS.SYS, TAGS.ORCH]
    },
    {
      view: 'Deterministic run recorder',
      text: 'Add a run recorder that captures inputs, tool calls, and outputs for exact replay.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.GOV]
    }
  ],
  'L3: Weak RSI': [
    {
      view: 'Arena debate convergence loop',
      text: 'Build a three persona debate loop with a fixed turn schedule and a convergence rule for final answers.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.BENCH]
    },
    {
      view: 'Persona tuner and scorer',
      text: 'Implement a persona tuner that mutates prompt traits and scores outputs on a benchmark set.',
      tags: [TAGS.ORCH, TAGS.BENCH, TAGS.DATA]
    },
    {
      view: 'Solution replay regression tracker',
      text: 'Create a regression tracker that reruns solutions, compares outputs, and flags deltas.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Self critique retry pipeline',
      text: 'Add a self critique loop that generates counterpoints and retries with a revised plan.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.DATA]
    },
    {
      view: 'Prototype and compare loop',
      text: 'Implement a loop that creates three solutions, runs them, and selects the best based on rules.',
      tags: [TAGS.ORCH, TAGS.BENCH, TAGS.DATA]
    },
    {
      view: 'Toolchain evolution loop',
      text: 'Build a loop that proposes a new tool, implements it, and validates with tests.',
      tags: [TAGS.ORCH, TAGS.SYS, TAGS.GOV]
    },
    {
      view: 'Conclusion memory and revisions',
      text: 'Create a conclusion memory store with evidence links and revision history in VFS.',
      tags: [TAGS.DATA, TAGS.GOV, TAGS.SYS]
    }
  ],
  'L4: Theoretical RSI': [
    {
      view: 'Autonomous core self rewrite',
      text: 'Redesign, implement, test, and deploy a better agent core without human input, then repeat the loop safely.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Self generated tool ecosystem',
      text: 'Invent, implement, validate, and integrate new tools that measurably improve capability.',
      tags: [TAGS.SYS, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Distilled reflection parity',
      text: 'Distill the agent behavior into a smaller reflection model and replace the runtime with matched quality.',
      tags: [TAGS.BENCH, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Self evolving safety policy',
      text: 'Evolve its own safety policy and enforcement while preserving alignment and measurable progress.',
      tags: [TAGS.GOV, TAGS.ORCH, TAGS.DATA]
    },
    {
      view: 'Cross run self improvement',
      text: 'Persist identity, memory, and improvement across restarts without manual guidance.',
      tags: [TAGS.ORCH, TAGS.SYS, TAGS.DATA]
    },
    {
      view: 'Autonomous research integration',
      text: 'Identify a missing capability, research it, integrate it, and show measurable gains.',
      tags: [TAGS.SYS, TAGS.BENCH, TAGS.DATA]
    },
    {
      view: 'Self optimizing governance loop',
      text: 'Spawn multiple personas, adapt the governance protocol, and improve solution quality without human tuning.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.BENCH]
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
