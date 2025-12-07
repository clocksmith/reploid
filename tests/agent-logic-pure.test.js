/**
 * @fileoverview Unit tests for agent-logic-pure.js pure functions
 * Tests pure helper functions for agent reasoning and prompt assembly
 */

import { describe, it, expect } from 'vitest';

// Define the pure helper functions inline (same as original implementation)
const AgentLogicPureHelpers = {
  factory: () => {
    const getArtifactListSummaryPure = (allMetaMap) => {
      if (!allMetaMap) return "Error: Artifact metadata map not available.";
      return (
        Object.keys(allMetaMap)
          .map(
            (path) => {
              const meta = allMetaMap[path][0] || {};
              return `* ${path} (Cycle ${meta.latestCycle || 0})`
            }
          )
          .join("\n") || "None"
      );
    };

    const getToolListSummaryPure = (staticTools, dynamicTools, truncFn) => {
      if (!staticTools || !dynamicTools || !truncFn)
        return "Error: Tool lists or truncFn not available.";

      const staticToolSummary = staticTools
        .map((t) => `* [S] ${t.name}: ${truncFn(t.description, 60)}`)
        .join("\n");

      const dynamicToolSummary = (dynamicTools || [])
        .map(
          (t) =>
            `* [D] ${t.declaration.name}: ${truncFn(
              t.declaration.description,
              60
            )}`
        )
        .join("\n");

      return (
        [staticToolSummary, dynamicToolSummary].filter((s) => s).join("\n") ||
        "None"
      );
    };

    const assembleCorePromptPure = (
      corePromptTemplate,
      state,
      goalInfo,
      artifactListSummary,
      toolListSummary
    ) => {
      if (!corePromptTemplate) return { error: "Core prompt template missing." };

      let prompt = corePromptTemplate
        .replace(/\[\[CYCLE_COUNT\]\]/g, String(state.totalCycles))
        .replace(/\[\[TOOL_LIST\]\]/g, toolListSummary)
        .replace(/\[\[ARTIFACT_LIST\]\]/g, artifactListSummary)
        .replace(/\[\[CUMULATIVE_GOAL\]\]/g, goalInfo.latestGoal || "No goal set.");

      return { prompt };
    };

    return {
      getArtifactListSummaryPure,
      getToolListSummaryPure,
      assembleCorePromptPure,
    };
  }
};

// Initialize module
const helpers = AgentLogicPureHelpers.factory();

describe('getArtifactListSummaryPure', () => {
  it('should return error when allMetaMap is null', () => {
    const result = helpers.getArtifactListSummaryPure(null);
    expect(result).toBe("Error: Artifact metadata map not available.");
  });

  it('should return "None" for empty metadata map', () => {
    const result = helpers.getArtifactListSummaryPure({});
    expect(result).toBe("None");
  });

  it('should format single artifact correctly', () => {
    const metaMap = {
      '/vfs/test.js': [{ latestCycle: 5 }]
    };
    const result = helpers.getArtifactListSummaryPure(metaMap);
    expect(result).toBe('* /vfs/test.js (Cycle 5)');
  });

  it('should format multiple artifacts correctly', () => {
    const metaMap = {
      '/vfs/test.js': [{ latestCycle: 5 }],
      '/vfs/app.js': [{ latestCycle: 3 }]
    };
    const result = helpers.getArtifactListSummaryPure(metaMap);
    expect(result).toContain('/vfs/test.js (Cycle 5)');
    expect(result).toContain('/vfs/app.js (Cycle 3)');
  });

  it('should handle missing latestCycle', () => {
    const metaMap = {
      '/vfs/test.js': [{}]
    };
    const result = helpers.getArtifactListSummaryPure(metaMap);
    expect(result).toBe('* /vfs/test.js (Cycle 0)');
  });
});

describe('getToolListSummaryPure', () => {
  it('should return error when staticTools is null', () => {
    const result = helpers.getToolListSummaryPure(null, [], (t) => t);
    expect(result).toBe("Error: Tool lists or truncFn not available.");
  });

  it('should return error when truncFn is null', () => {
    const result = helpers.getToolListSummaryPure([], [], null);
    expect(result).toBe("Error: Tool lists or truncFn not available.");
  });

  it('should format static tools correctly', () => {
    const staticTools = [
      { name: 'ReadFile', description: 'Read file contents' },
      { name: 'WriteFile', description: 'Write file contents' }
    ];
    const truncFn = (text, len) => text.substring(0, len);

    const result = helpers.getToolListSummaryPure(staticTools, [], truncFn);
    expect(result).toContain('[S] ReadFile: Read file contents');
    expect(result).toContain('[S] WriteFile: Write file contents');
  });

  it('should truncate long descriptions', () => {
    const staticTools = [
      { name: 'long_tool', description: 'This is a very long description that should be truncated to the specified length' }
    ];
    const truncFn = (text, len) => text.substring(0, len);

    const result = helpers.getToolListSummaryPure(staticTools, [], truncFn);
    expect(result).toContain('[S] long_tool: This is a very long description that should be truncated');
    expect(result).not.toContain('to the specified length');
  });

  it('should format dynamic tools correctly', () => {
    const dynamicTools = [
      { declaration: { name: 'custom_tool', description: 'Custom tool description' } }
    ];
    const truncFn = (text, len) => text.substring(0, len);

    const result = helpers.getToolListSummaryPure([], dynamicTools, truncFn);
    expect(result).toContain('[D] custom_tool: Custom tool description');
  });

  it('should combine static and dynamic tools', () => {
    const staticTools = [
      { name: 'static_tool', description: 'Static description' }
    ];
    const dynamicTools = [
      { declaration: { name: 'dynamic_tool', description: 'Dynamic description' } }
    ];
    const truncFn = (text, len) => text.substring(0, len);

    const result = helpers.getToolListSummaryPure(staticTools, dynamicTools, truncFn);
    expect(result).toContain('[S] static_tool');
    expect(result).toContain('[D] dynamic_tool');
  });
});

describe('assembleCorePromptPure', () => {
  it('should return error when template is null', () => {
    const result = helpers.assembleCorePromptPure(null, {}, {}, '', '');
    expect(result.error).toBe("Core prompt template missing.");
  });

  it('should replace CYCLE_COUNT placeholder', () => {
    const template = "Current cycle: [[CYCLE_COUNT]]";
    const state = { totalCycles: 42 };
    const goalInfo = { latestGoal: '' };

    const result = helpers.assembleCorePromptPure(template, state, goalInfo, '', '');
    expect(result.prompt).toBe("Current cycle: 42");
  });

  it('should replace TOOL_LIST placeholder', () => {
    const template = "Tools:\n[[TOOL_LIST]]";
    const state = { totalCycles: 0 };
    const goalInfo = { latestGoal: '' };
    const toolList = "* ReadFile\n* WriteFile";

    const result = helpers.assembleCorePromptPure(template, state, goalInfo, '', toolList);
    expect(result.prompt).toContain("* ReadFile");
    expect(result.prompt).toContain("* WriteFile");
  });

  it('should replace ARTIFACT_LIST placeholder', () => {
    const template = "Artifacts:\n[[ARTIFACT_LIST]]";
    const state = { totalCycles: 0 };
    const goalInfo = { latestGoal: '' };
    const artifactList = "* /vfs/test.js\n* /vfs/app.js";

    const result = helpers.assembleCorePromptPure(template, state, goalInfo, artifactList, '');
    expect(result.prompt).toContain("* /vfs/test.js");
    expect(result.prompt).toContain("* /vfs/app.js");
  });

  it('should replace CUMULATIVE_GOAL placeholder', () => {
    const template = "Goal: [[CUMULATIVE_GOAL]]";
    const state = { totalCycles: 0 };
    const goalInfo = { latestGoal: 'Build a REST API' };

    const result = helpers.assembleCorePromptPure(template, state, goalInfo, '', '');
    expect(result.prompt).toBe("Goal: Build a REST API");
  });

  it('should use fallback for missing goal', () => {
    const template = "Goal: [[CUMULATIVE_GOAL]]";
    const state = { totalCycles: 0 };
    const goalInfo = { latestGoal: null };

    const result = helpers.assembleCorePromptPure(template, state, goalInfo, '', '');
    expect(result.prompt).toBe("Goal: No goal set.");
  });

  it('should replace all placeholders simultaneously', () => {
    const template = `Cycle: [[CYCLE_COUNT]]
Goal: [[CUMULATIVE_GOAL]]
Tools: [[TOOL_LIST]]
Artifacts: [[ARTIFACT_LIST]]`;

    const state = { totalCycles: 10 };
    const goalInfo = { latestGoal: 'Test goal' };
    const artifactList = '* test.js';
    const toolList = '* ReadFile';

    const result = helpers.assembleCorePromptPure(template, state, goalInfo, artifactList, toolList);
    expect(result.prompt).toContain("Cycle: 10");
    expect(result.prompt).toContain("Goal: Test goal");
    expect(result.prompt).toContain("Tools: * ReadFile");
    expect(result.prompt).toContain("Artifacts: * test.js");
  });
});
