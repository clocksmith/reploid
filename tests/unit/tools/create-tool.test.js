import { afterEach, describe, expect, it, vi } from 'vitest';

import CreateTool from '../../../self/tools/CreateTool.js';

const VALID_CODE = `export const tool = {
  name: 'KatamariEngine',
  activation: {
    checks: [
      {
        name: 'echoes activation input',
        args: { value: 'activation' },
        expected: { value: 'activation' }
      }
    ]
  }
};

export default async function(args) {
  return args;
}`;

const getWrittenEvidence = (deps) => {
  const call = deps.VFS.write.mock.calls.find(([path]) => path === '/artifacts/KatamariEngine-evidence.json');
  return call ? JSON.parse(call[1]) : null;
};

const makeDeps = () => ({
  ToolWriter: {
    create: vi.fn().mockResolvedValue({
      success: true,
      name: 'KatamariEngine',
      path: '/shadow/tools/KatamariEngine.js',
      staged: true,
      toolLoaded: false,
      toolLoadError: null
    })
  },
  VFS: {
    read: vi.fn().mockResolvedValue(VALID_CODE),
    write: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    exists: vi.fn().mockResolvedValue(false)
  },
  ToolRunner: {
    loadPath: vi.fn().mockResolvedValue(true),
    unload: vi.fn().mockResolvedValue(true),
    has: vi.fn().mockReturnValue(false)
  },
  EventBus: {
    emit: vi.fn()
  },
  AuditLogger: {
    logEvent: vi.fn().mockResolvedValue(true)
  }
});

describe('CreateTool', () => {
  afterEach(() => {
    delete globalThis.__reploidCreateToolReplayProbe;
    vi.unstubAllGlobals();
  });

  it('installs and loads created tools in Zero', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const deps = makeDeps();

    const result = await CreateTool({
      name: 'KatamariEngine',
      code: VALID_CODE
    }, deps);

    expect(deps.ToolWriter.create).toHaveBeenCalledWith(
      'KatamariEngine',
      VALID_CODE,
      { root: '/shadow/tools', load: false }
    );
    expect(deps.VFS.read).toHaveBeenCalledWith('/shadow/tools/KatamariEngine.js');
    expect(deps.VFS.write).toHaveBeenCalledWith(
      '/artifacts/KatamariEngine-evidence.json',
      expect.stringContaining('"schema": "reploid.zero.createToolEvidence.v3"')
    );
    expect(deps.VFS.write).toHaveBeenCalledWith(
      '/artifacts/KatamariEngine-evidence.json',
      expect.stringContaining('"candidateHash"')
    );
    expect(deps.VFS.write).toHaveBeenCalledWith(
      '/artifacts/KatamariEngine-evidence.json',
      expect.stringContaining('"validationPassed": true')
    );
    expect(deps.VFS.write).toHaveBeenCalledWith(
      '/self/tools/KatamariEngine.js',
      VALID_CODE
    );
    expect(deps.ToolRunner.loadPath).toHaveBeenCalledWith(
      '/self/tools/KatamariEngine.js',
      'KatamariEngine',
      { allow: true }
    );
    expect(result).toMatchObject({
      success: true,
      name: 'KatamariEngine',
      path: '/shadow/tools/KatamariEngine.js',
      activated: true,
      targetPath: '/self/tools/KatamariEngine.js',
      evidencePath: '/artifacts/KatamariEngine-evidence.json',
      validationPassed: true,
      activationChecksPassed: true,
      replayPassed: true,
      loaded: true,
      toolLoaded: true
    });
    expect(getWrittenEvidence(deps)).toMatchObject({
      validationPassed: true,
      activationChecksPassed: true,
      replayPassed: true,
      activated: true,
      checks: {
        validation: {
          moduleImported: true,
          activationContractValid: true,
          activationCheckCount: 1
        },
        activation: {
          executed: true,
          declaredChecksPassed: true,
          installedBytesMatch: true,
          runtimeLoaded: true,
          passed: true
        },
        replay: {
          executed: true,
          matchesActivationTranscript: true,
          passed: true
        }
      },
      failure: null
    });
  });

  it('compiles the structured tool definition emitted by text models', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const deps = makeDeps();
    let stagedCode = '';
    deps.ToolWriter.create.mockImplementation(async (name, code) => {
      stagedCode = code;
      return {
        success: true,
        name,
        path: `/shadow/tools/${name}.js`,
        staged: true,
        toolLoaded: false,
        toolLoadError: null
      };
    });
    deps.VFS.read.mockImplementation(async () => stagedCode);

    const result = await CreateTool({
      name: 'KatamariEngine',
      description: 'Structured model output.',
      activation: {
        fixtures: {},
        checks: [{
          name: 'echoes activation input',
          args: { value: 'activation' },
          expected: { value: 'activation' }
        }]
      },
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } }
      },
      capabilities: ['dom:read'],
      call: 'async (args) => args'
    }, deps);

    expect(stagedCode).toContain("name: \"KatamariEngine\"");
    expect(stagedCode).toContain('const call = (');
    expect(stagedCode).toContain('async (args) => args');
    expect(stagedCode).toContain('export default call;');
    expect(result).toMatchObject({
      name: 'KatamariEngine',
      activated: true,
      validationPassed: true,
      activationChecksPassed: true,
      replayPassed: true
    });
  });

  it('returns the canonical CreateTool syntax when neither code nor call is present', async () => {
    const deps = makeDeps();

    await expect(CreateTool({
      name: 'KatamariEngine',
      description: 'Incomplete structured definition.'
    }, deps)).rejects.toThrow('pass module source in code <<EOF ... EOF');

    expect(deps.ToolWriter.create).not.toHaveBeenCalled();
  });

  it('rejects a callable candidate whose activation check fails', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const code = `export const tool = {
  name: 'KatamariEngine',
  activation: {
    checks: [{ name: 'reports success', args: {}, expected: { ok: true } }]
  }
};

export default async function() {
  return { ok: false };
}`;
    const deps = makeDeps();
    deps.VFS.read.mockResolvedValue(code);

    await expect(CreateTool({ name: 'KatamariEngine', code }, deps))
      .rejects.toThrow('activation check reports success failed');

    expect(deps.VFS.write).not.toHaveBeenCalledWith('/self/tools/KatamariEngine.js', code);
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
    expect(getWrittenEvidence(deps)).toMatchObject({
      validationPassed: true,
      activationChecksPassed: false,
      replayPassed: false,
      activated: false,
      failure: {
        stage: 'activation_checks'
      },
      checks: {
        activation: {
          executed: true,
          declaredChecksPassed: false
        },
        replay: {
          executed: false
        }
      }
    });
  });

  it('rejects an import-only callable without an activation contract', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const code = 'export default async function(args) { return args; }';
    const deps = makeDeps();
    deps.VFS.read.mockResolvedValue(code);

    await expect(CreateTool({ name: 'KatamariEngine', code }, deps))
      .rejects.toThrow('must declare tool.activation');

    expect(deps.VFS.write).not.toHaveBeenCalledWith('/self/tools/KatamariEngine.js', code);
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
    expect(getWrittenEvidence(deps)).toMatchObject({
      validationPassed: false,
      activationChecksPassed: false,
      replayPassed: false,
      activated: false,
      failure: {
        stage: 'validation'
      },
      checks: {
        validation: {
          executed: true,
          passed: false
        },
        activation: {
          executed: false
        },
        replay: {
          executed: false
        }
      }
    });
  });

  it('runs activation checks with the candidate runtime capabilities', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const code = `export const tool = {
  name: 'KatamariEngine',
  activation: {
    checks: [{ name: 'writes a file', args: {}, expected: { ok: true } }]
  }
};

export default async function(args, deps) {
  await deps.VFS.write('/activation/output.txt', 'written');
  return { ok: true };
}`;
    const deps = makeDeps();
    deps.VFS.read.mockResolvedValue(code);

    await expect(CreateTool({ name: 'KatamariEngine', code }, deps))
      .rejects.toThrow(/VFS\.write is not a function/);

    expect(deps.VFS.write).not.toHaveBeenCalledWith('/self/tools/KatamariEngine.js', code);
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
    expect(getWrittenEvidence(deps)).toMatchObject({
      validationPassed: true,
      activationChecksPassed: false,
      replayPassed: false,
      activated: false,
      checks: {
        validation: {
          declaredCapabilities: []
        },
        activation: {
          declaredChecksPassed: false
        }
      }
    });
  });

  it('rejects a candidate whose replay transcript differs', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const code = `export const tool = {
  name: 'KatamariEngine',
  activation: {
    checks: [{ name: 'runs successfully', args: {}, expected: { ok: true } }]
  }
};

export default async function() {
  globalThis.__reploidCreateToolReplayProbe = (globalThis.__reploidCreateToolReplayProbe || 0) + 1;
  return { ok: true, run: globalThis.__reploidCreateToolReplayProbe };
}`;
    const deps = makeDeps();
    deps.VFS.read.mockResolvedValue(code);

    await expect(CreateTool({ name: 'KatamariEngine', code }, deps))
      .rejects.toThrow('replay failed');

    expect(deps.VFS.write).not.toHaveBeenCalledWith('/self/tools/KatamariEngine.js', code);
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
    expect(getWrittenEvidence(deps)).toMatchObject({
      validationPassed: true,
      activationChecksPassed: false,
      replayPassed: false,
      activated: false,
      failure: {
        stage: 'replay'
      },
      checks: {
        activation: {
          executed: true,
          declaredChecksPassed: true
        },
        replay: {
          executed: true,
          matchesActivationTranscript: false,
          passed: false
        }
      }
    });
  });

  it('removes the installed target when runtime loading fails', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const deps = makeDeps();
    deps.ToolRunner.loadPath.mockResolvedValue(false);

    await expect(CreateTool({ name: 'KatamariEngine', code: VALID_CODE }, deps))
      .rejects.toThrow('failed to load');

    expect(deps.VFS.write).toHaveBeenCalledWith('/self/tools/KatamariEngine.js', VALID_CODE);
    expect(deps.ToolRunner.unload).toHaveBeenCalledWith('KatamariEngine');
    expect(deps.VFS.delete).toHaveBeenCalledWith('/self/tools/KatamariEngine.js');
    expect(getWrittenEvidence(deps)).toMatchObject({
      validationPassed: true,
      activationChecksPassed: false,
      replayPassed: true,
      activated: false,
      failure: {
        stage: 'runtime_load',
        cleanup: {
          runtimeUnloadAttempted: true,
          runtimeUnloadSucceeded: true,
          targetRemovalAttempted: true,
          targetRemovalSucceeded: true,
          runtimeStillLoaded: false,
          targetStillExists: false,
          errors: []
        }
      },
      checks: {
        activation: {
          declaredChecksPassed: true,
          installedBytesMatch: true,
          runtimeLoaded: false,
          passed: false
        },
        replay: {
          passed: true
        }
      }
    });
  });

  it('keeps staged-only behavior outside Zero', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'x'
    });
    const deps = makeDeps();

    const result = await CreateTool({
      name: 'KatamariEngine',
      code: VALID_CODE
    }, deps);

    expect(deps.VFS.write).not.toHaveBeenCalled();
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      name: 'KatamariEngine',
      staged: true,
      toolLoaded: false
    });
  });

  it('quarantines protected Zero validator activation targets', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const deps = makeDeps();
    deps.ToolWriter.create.mockResolvedValue({
      success: true,
      name: 'Promote',
      path: '/shadow/tools/Promote.js',
      staged: true
    });

    const result = await CreateTool({
      name: 'Promote',
      code: VALID_CODE
    }, deps);

    expect(deps.VFS.read).not.toHaveBeenCalled();
    expect(deps.VFS.write).toHaveBeenCalledTimes(1);
    expect(deps.VFS.write).toHaveBeenCalledWith(
      '/artifacts/quarantine/Promote-create-tool-quarantine.json',
      expect.stringContaining('"reason": "protected_validator_mutation_target"')
    );
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
    expect(deps.EventBus.emit).toHaveBeenCalledWith('tool:create_quarantined', expect.objectContaining({
      name: 'Promote',
      targetPath: '/self/tools/Promote.js',
      quarantinePath: '/artifacts/quarantine/Promote-create-tool-quarantine.json'
    }));
    expect(result).toMatchObject({
      ok: false,
      success: false,
      activated: false,
      quarantined: true,
      reason: 'protected_validator_mutation_target',
      targetPath: '/self/tools/Promote.js',
      quarantinePath: '/artifacts/quarantine/Promote-create-tool-quarantine.json'
    });
  });

  it('does not overwrite an existing installed Zero tool', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const deps = makeDeps();
    deps.VFS.exists.mockResolvedValue(true);

    await expect(CreateTool({
      name: 'KatamariEngine',
      code: VALID_CODE
    }, deps)).rejects.toThrow('already exists');

    expect(deps.VFS.write).not.toHaveBeenCalled();
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
  });
});
