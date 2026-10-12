// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { residentOpeningBoundary, observeResidentOpening } from '../fixtures/resident-opening-observer.js';

const factorySource = 'async function open() {\n  handle = opened;\n}', identitySource = 'export function observeInitialExecutionIdentity() {}';
function fixture({ factory = factorySource, helper = identitySource, exception = false, missing = false } = {}) {
  const events = {}, calls = [], resolved = { runtime: { session: { intermediatePrecision: 'two-f32' } } };
  const cdp = { on: (name, callback) => { events[name] = callback; }, async detach() { calls.push('detach'); }, async send(method, args) {
    calls.push(method);
    if (method === 'Debugger.setBreakpointByUrl') return { breakpointId: 'owned' };
    if (method === 'Debugger.getScriptSource') return { scriptSource: args.scriptId === 'factory' ? factory : helper };
    if (method === 'Runtime.evaluate') {
      expect(args.expression).toContain(JSON.stringify(resolved));
      events['Debugger.scriptParsed']({ url: 'http://localhost/vendor/runtime/src/config/initial-execution-identity.js', scriptId: 'identity' });
      return { result: { value: { derivedFromActualResolved: true } } };
    }
    if (method === 'Debugger.evaluateOnCallFrame') return { exceptionDetails: exception ? { text: 'unavailable' } : undefined,
      result: { value: missing ? {} : { resolvedRuntimeSession: resolved, partitionIndex: 1, planId: 'actual-plan', modelIdentity: 'actual-model' } } };
    return {};
  } };
  const page = { context: () => ({ newCDPSession: async () => cdp }) };
  return { page, calls, pause: (hit = 'owned') => events['Debugger.paused']({ hitBreakpoints: [hit], callFrames: [{ callFrameId: 'frame', location: { scriptId: 'factory' } }] }) };
}
const options = { runtimeBaseUrl: 'http://localhost/vendor/runtime/src/', factorySource, identitySource };
describe('installed resident identity observation', () => {
  it('requires one exact source boundary', () => {
    expect(residentOpeningBoundary(factorySource)).toBe(1);
    expect(() => residentOpeningBoundary('')).toThrow(/unique/);
    expect(() => residentOpeningBoundary(factorySource + '\nhandle = opened;')).toThrow(/unique/);
  });
  it('observes actual state and checks both executed source hashes', async () => {
    const f = fixture(), observer = await observeResidentOpening(f.page, options); f.pause();
    const result = await observer.finish();
    expect(result.partitionIndex).toBe(1); expect(result.planId).toBe('actual-plan');
    expect(result.initialExecutionIdentity.derivedFromActualResolved).toBe(true);
    await observer.close(); expect(f.calls).toContain('Debugger.resume'); expect(f.calls.at(-1)).toBe('detach');
  });
  for (const [name, changes] of [['changed factory', { factory: 'changed' }], ['changed helper', { helper: 'changed' }],
    ['unavailable lexical value', { exception: true }], ['missing state', { missing: true }]]) {
    it(`rejects ${name} and resumes`, async () => {
      const f = fixture(changes), observer = await observeResidentOpening(f.page, options); f.pause();
      await expect(observer.finish()).rejects.toThrow(); await observer.close(); expect(f.calls).toContain('Debugger.resume');
    });
  }
  it('rejects absent or duplicate observations', async () => {
    const f = fixture(), observer = await observeResidentOpening(f.page, options);
    await expect(observer.finish()).rejects.toThrow(/Exactly one/);
    f.pause(); await observer.finish(); f.pause(); await expect(observer.finish()).rejects.toThrow(/Exactly one/);
    await observer.close();
  });
});
