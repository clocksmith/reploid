import { expect, it, vi } from 'vitest';
import { resolveSelfAuthorization } from '../../self/tool-authorization.js';
import { createSelfToolRunner } from '../../self/tool-runner.js';

it('denies execution and promotion unless the host explicitly authorizes them', async () => {
  const write = vi.fn(), promote = vi.fn(), loadModule = vi.fn();
  const runner = createSelfToolRunner({ builtInTools: { WriteFile: write, Promote: promote },
    loadModule, isLoadablePath: () => true });
  await runner.executeTool('WriteFile', { path: '/shadow/candidate.js', content: 'candidate' });
  expect(write).toHaveBeenCalledOnce();
  await expect(runner.executeTool('Promote', { path: '/shadow/candidate.js' })).rejects.toThrow('Host denied');
  await expect(runner.executeTool('LoadModule', { path: '/self/candidate.js' })).rejects.toThrow('Host denied');
  expect(promote).not.toHaveBeenCalled();
  expect(loadModule).not.toHaveBeenCalled();
  expect(resolveSelfAuthorization()({ action: 'permissions.escalate', name: 'ReadFile' })).toBe(false);
  const bound = resolveSelfAuthorization(undefined, { instanceId: 'owned', goal: 'Inspect source' });
  expect(bound({ action: 'agent.execute', instanceId: 'owned', goal: 'Inspect source' })).toBe(true);
  expect(bound({ action: 'agent.execute', instanceId: 'other', goal: 'Inspect source' })).toBe(false);
  expect(bound({ action: 'agent.execute', instanceId: 'owned', goal: 'Different goal' })).toBe(false);
});

it('preserves an explicit host decision and rejects malformed authorization ports', async () => {
  const promote = vi.fn(), authorize = vi.fn(request => request.name === 'Promote');
  const runner = createSelfToolRunner({ authorize, builtInTools: { Promote: promote } });
  await runner.executeTool('Promote', { candidate: 'reviewed' });
  expect(promote).toHaveBeenCalledOnce();
  await expect(runner.executeTool('ReadFile', { path: '/self/self.json' })).rejects.toThrow('Host denied');
  expect(() => resolveSelfAuthorization(true)).toThrow(TypeError);
});
