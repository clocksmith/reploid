/**
 * @fileoverview Goal presets for the boot wizard.
 */

const GOAL_CATEGORIES = {
  'L0: Basic Functions': [
    {
      view: 'Build a WebGL shader editor panel',
      text: 'Create a WebGL-based tool that renders custom GLSL shaders with live editing in the existing Reploid UI.'
    },
    {
      view: 'Add a VFS search tool',
      text: 'Build a tool that searches the VFS and returns match snippets with file paths.'
    },
    {
      view: 'Create a DOM snapshot exporter',
      text: 'Implement a tool that captures the current DOM and writes a snapshot file to /artifacts.'
    },
    {
      view: 'Build a markdown preview panel',
      text: 'Add a UI panel that previews markdown files from the VFS inside the existing dashboard.'
    },
    {
      view: 'Create a CSS theme switcher',
      text: 'Add a UI control to toggle between two CSS themes without reloading the page.'
    },
    {
      view: 'Summarize repo structure',
      text: 'Scan the VFS and produce a concise architecture summary with key directories and their roles.'
    },
    {
      view: 'Add a log filter tool',
      text: 'Create a tool that filters /logs output by severity and time range.'
    }
  ],
  'L1: Meta Tooling': [
    {
      view: 'Generate a tool template',
      text: 'Create a helper that scaffolds new tools with input schemas and usage notes.'
    },
    {
      view: 'Audit tool inputs',
      text: 'Scan tool schemas for missing descriptions or type mismatches and report fixes.'
    },
    {
      view: 'Add a tool smoke-test runner',
      text: 'Implement a runner that executes a list of tools with sample inputs and reports failures.'
    },
    {
      view: 'Build a diff report tool',
      text: 'Create a tool that compares two VFS paths and summarizes changed sections.'
    },
    {
      view: 'Create a config validator',
      text: 'Validate config JSON files against schema rules and report any violations.'
    },
    {
      view: 'Add a dependency mapper',
      text: 'Generate a dependency graph for core modules and highlight cycles.'
    },
    {
      view: 'Create a module hot-reload checker',
      text: 'Verify that VFS module reloads propagate cleanly without stale caches.'
    }
  ],
  'L2: Substrate': [
    {
      view: 'Audit substrate boot order',
      text: 'Trace boot sequence and validate module ordering against genesis configuration.'
    },
    {
      view: 'Verify VFS integrity path',
      text: 'Check that VFS hydration and module loading paths are consistent and logged.'
    },
    {
      view: 'HITL gate coverage review',
      text: 'Identify which actions are guarded by HITL and list gaps that need approval.'
    },
    {
      view: 'Policy engine enforcement map',
      text: 'Enumerate policy rules and show where they are enforced in runtime.'
    },
    {
      view: 'Genesis snapshot flow review',
      text: 'Validate snapshot creation and rollback flows with clear failure modes.'
    },
    {
      view: 'Module registry integrity check',
      text: 'Cross-check module registry entries against actual files and dependencies.'
    },
    {
      view: 'Substrate log consolidation',
      text: 'Ensure substrate logs are consistent and traceable across boot and runtime.'
    }
  ],
  'L3: Weak RSI': [
    {
      view: 'Iterative tool improvement loop',
      text: 'Improve a selected tool over three iterations with measurable deltas.'
    },
    {
      view: 'Automated refactor proposal',
      text: 'Generate a refactor plan for a subsystem and validate against style guide.'
    },
    {
      view: 'Performance profiling plan',
      text: 'Build a profiling checklist and run targeted measurements.'
    },
    {
      view: 'Schema drift detection',
      text: 'Detect schema drift between docs and runtime config defaults.'
    },
    {
      view: 'Regression test authoring',
      text: 'Add targeted tests for a recently changed module.'
    },
    {
      view: 'Toolset coverage audit',
      text: 'List missing tools for common workflows and propose additions.'
    },
    {
      view: 'Recovery plan simulation',
      text: 'Simulate a failure and produce a recovery playbook.'
    }
  ],
  'L4: Theoretical RSI': [
    {
      view: 'Self-modification safety proof',
      text: 'Draft a proof outline for safe self-modification under bounded constraints.',
      locked: true,
      lockReason: 'Theoretical'
    },
    {
      view: 'Unbounded optimization model',
      text: 'Propose a theoretical model for unbounded optimization and its safety limits.',
      locked: true,
      lockReason: 'Theoretical'
    },
    {
      view: 'Recursive alignment plan',
      text: 'Describe a recursive alignment strategy and identify non-implementable steps.',
      locked: true,
      lockReason: 'Theoretical'
    },
    {
      view: 'Formal verifier design',
      text: 'Sketch a formal verifier for tool outputs with clear limitations.',
      locked: true,
      lockReason: 'Theoretical'
    },
    {
      view: 'Self-improvement theorem',
      text: 'State a theorem about self-improvement and outline a proof attempt.',
      locked: true,
      lockReason: 'Theoretical'
    },
    {
      view: 'Infinite recursion bounds',
      text: 'Analyze recursion bounds and identify practical stopping criteria.',
      locked: true,
      lockReason: 'Theoretical'
    },
    {
      view: 'Alignment impossibility survey',
      text: 'Summarize known impossibility results and their relevance to this system.',
      locked: true,
      lockReason: 'Theoretical'
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
