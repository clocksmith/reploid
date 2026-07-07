import { afterEach, describe, expect, it, vi } from 'vitest';

import CreateTool from '../../../self/tools/CreateTool.js';

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
    read: vi.fn().mockResolvedValue('export default async function(args) { return args; }'),
    write: vi.fn().mockResolvedValue(true),
    exists: vi.fn().mockResolvedValue(false)
  },
  ToolRunner: {
    loadPath: vi.fn().mockResolvedValue(true)
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
    vi.unstubAllGlobals();
  });

  it('installs and loads created tools in Zero', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'zero'
    });
    const deps = makeDeps();

    const result = await CreateTool({
      name: 'KatamariEngine',
      code: 'export default async function(args) { return args; }'
    }, deps);

    expect(deps.ToolWriter.create).toHaveBeenCalledWith(
      'KatamariEngine',
      'export default async function(args) { return args; }',
      { root: '/shadow/tools', load: false }
    );
    expect(deps.VFS.read).toHaveBeenCalledWith('/shadow/tools/KatamariEngine.js');
    expect(deps.VFS.write).toHaveBeenCalledWith(
      '/artifacts/KatamariEngine-evidence.json',
      expect.stringContaining('"schema": "reploid.zero.createToolEvidence.v2"')
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
      'export default async function(args) { return args; }'
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
      loaded: true,
      toolLoaded: true
    });
  });

  it('keeps staged-only behavior outside Zero', async () => {
    vi.stubGlobal('window', {
      getReploidMode: () => 'x'
    });
    const deps = makeDeps();

    const result = await CreateTool({
      name: 'KatamariEngine',
      code: 'export default async function(args) { return args; }'
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
      code: 'export default async function(args) { return args; }'
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
      code: 'export default async function(args) { return args; }'
    }, deps)).rejects.toThrow('already exists');

    expect(deps.VFS.write).not.toHaveBeenCalled();
    expect(deps.ToolRunner.loadPath).not.toHaveBeenCalled();
  });
});
