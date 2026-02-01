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
      view: 'Plasma playground panel',
      text: 'Add a main area panel that renders a live plasma field with electromagnetic effects and at least three sliders to control magnetism and plasma dynamics.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    },
    {
      view: 'Cycle state summarizer',
      text: 'Create a tool that summarizes the current state each cycle in 256, 64, 16, 4, and 1 words, and saves each version to /cyclesummaries/ for comparison.',
      tags: [TAGS.DATA, TAGS.BENCH, TAGS.SYS]
    },
    {
      view: 'Power tower overlay',
      text: 'Create an overlay appended to the dashboard body that visualizes power towers and responds to numeric keyboard input, for example 5 maps to 5^5^5^5^5 and 7 maps to 7^7^7^7^7^7^7. Include a keyboard shortcut to toggle the overlay.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.DATA]
    },
    {
      view: 'Katamari DOM sweep overlay',
      text: 'Create a katamari ball overlay that rolls across the dashboard and scoops DOM elements. Pickup rules depend on element size relative to the ball. The ball grows as it absorbs elements. End the run when the full dashboard DOM is consumed.',
      tags: [TAGS.UI, TAGS.VISUAL, TAGS.SYS]
    },
    {
      view: 'Snapshot capture panel',
      text: 'Add a capture panel that saves snapshots of #workspace-columns, plus any active canvas, to /artifacts with a timestamped label.',
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
      view: 'Page color toolset',
      text: 'Build a page color toolset that can apply and revert color themes across the dashboard, including palette presets, contrast checks, and a diff report of changed elements.',
      tags: [TAGS.UI, TAGS.SYS, TAGS.DATA]
    },
    {
      view: 'Tool generator forge',
      text: 'Build a tool that takes a structured prompt, outputs a new tool with schema, tests, and usage notes, then registers it.',
      tags: [TAGS.SYS, TAGS.DATA, TAGS.GOV]
    },
    {
      view: 'Tool generator generator',
      text: 'Create a meta tool that produces tool generator templates and validates that generated tools pass a smoke test.',
      tags: [TAGS.SYS, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Persona library editor',
      text: 'Create a persona editor panel that stores named personas in local workspace storage and lets users set the active persona.',
      tags: [TAGS.UI, TAGS.ORCH, TAGS.DATA]
    },
    }
  ],
  'L2: Substrate': [
    {
      view: 'Three agent coordinator',
      text: 'Implement a coordinator that spawns three personas, assigns roles, and merges output into one decision packet.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.DATA]
    },
    {
      view: 'VFS integrity audit pipeline',
      text: 'Add a pipeline that hashes critical runtime paths on milestones and reports drift with clear remediation steps.',
      tags: [TAGS.GOV, TAGS.DATA, TAGS.SYS]
    },
    {
      view: 'Security periscope overlay',
      text: 'Create a live security periscope overlay that visualizes substrate risk in real time: highlight /core and /infrastructure edits, show verification outcomes as pulses, and animate a risk ring that grows or shrinks based on recent violations or rollbacks.',
      tags: [TAGS.UI, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Iframe clone benchmark runner',
      text: 'Spawn a full UI clone in an iframe, run the same goal, and report latency, success, and quality deltas.',
      tags: [TAGS.GOV, TAGS.SYS, TAGS.DATA]
    }
  ],
  'L3: Weak RSI': [
    {
      view: 'Core self-patch loop',
      text: 'Implement a bounded self-patch loop that diagnoses its own failure patterns, proposes edits to /core/agent-loop.js, verifies in sandbox, and auto-rolls back on regression. Include a self-audit note that explains why the patch was applied.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Verification policy evolution',
      text: 'Create a feedback loop that adjusts verification rules in /core/verification-manager.js using observed false positives and negatives, records the rationale, and requires arena consensus plus rollback.',
      tags: [TAGS.GOV, TAGS.SYS, TAGS.DATA]
    },
    {
      view: 'Prompt kernel mutation gate',
      text: 'Enable controlled mutations of core system prompt rules in /core/persona-manager.js, score them on benchmark goals, require a self-review of failures, and revert on drops.',
      tags: [TAGS.ORCH, TAGS.BENCH, TAGS.GOV]
    },
    {
      view: 'Substrate regression harness',
      text: 'Build a substrate regression harness that replays a fixed goal set against modified core modules before commit, stores diffs, emits a regression summary, and auto-reverts on failures.',
      tags: [TAGS.BENCH, TAGS.GOV, TAGS.SYS]
    }
  ],
  'L4: Theoretical RSI': [
    {
      view: 'Autonomous core self rewrite',
      text: 'Redesign, implement, test, and deploy a better agent core without human input, then repeat the loop safely.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
    },
    {
      view: 'Cross-reploid federation signal',
      text: 'Design a protocol that allows one Reploid instance to signal its presence, discover peers, and form a cooperative federation with shared goals and governance safeguards, then demonstrate a safe join and leave handshake with audit logs.',
      tags: [TAGS.ORCH, TAGS.GOV, TAGS.SYS]
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
