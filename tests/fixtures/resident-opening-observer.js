/** Test-only CDP observation of an unchanged installed manifest factory. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const hash = text => createHash('sha256').update(text).digest('hex');
const boundary = 'handle = opened;';

export function residentOpeningBoundary(source) {
  const lines = source.split('\n');
  const found = lines.map((line, index) => line.trim() === boundary ? index : -1).filter(index => index >= 0);
  assert.equal(found.length, 1, 'Exact installed resident opening boundary must be unique');
  return found[0];
}

export async function observeResidentOpening(page, { runtimeBaseUrl, factorySource, identitySource }) {
  const factoryUrl = new URL('client/resident-partitions.js', runtimeBaseUrl).href;
  const identityUrl = new URL('config/initial-execution-identity.js', runtimeBaseUrl).href;
  const factoryHash = hash(factorySource), identityHash = hash(identitySource);
  const cdp = await page.context().newCDPSession(page);
  const observations = [], errors = [], scripts = new Map();
  let pausedWork = Promise.resolve(), breakpoint;
  cdp.on('Debugger.scriptParsed', event => scripts.set(event.url, event.scriptId));
  cdp.on('Debugger.paused', event => {
    pausedWork = (async () => {
      try {
        if (!event.hitBreakpoints?.includes(breakpoint.breakpointId)) return;
        const frame = event.callFrames[0];
        const served = await cdp.send('Debugger.getScriptSource', { scriptId: frame.location.scriptId });
        assert.equal(hash(served.scriptSource), factoryHash, 'Served factory differs from installed archive');
        const result = await cdp.send('Debugger.evaluateOnCallFrame', {
          callFrameId: frame.callFrameId, returnByValue: true,
          expression: '({ resolvedRuntimeSession: opened.advanced.getResolvedRuntimeSession(), partitionIndex: allocation.index, planId: allocation.planId, modelIdentity: allocation.model.identity })'
        });
        assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
        assert(result.result.value?.resolvedRuntimeSession, 'Actual opened session was not observed');
        observations.push(result.result.value);
      } catch (error) { errors.push(error); }
      finally { await cdp.send('Debugger.resume').catch(error => errors.push(error)); }
    })();
  });
  try {
    await cdp.send('Debugger.enable');
    breakpoint = await cdp.send('Debugger.setBreakpointByUrl', {
      url: factoryUrl, lineNumber: residentOpeningBoundary(factorySource)
    });
  } catch (error) { await cdp.detach(); throw error; }
  return {
    async finish() {
      await pausedWork;
      if (errors.length) throw new AggregateError(errors, 'Resident opening observation failed');
      assert.equal(observations.length, 1, 'Exactly one actual resident opening observation required');
      const observation = observations[0];
      // Derive from the observed resolved object with the installed helper, never
      // from a requested configuration or an expected identity.
      // Use the same CDP session so scriptParsed precedes this response; another
      // Playwright session can otherwise finish before our Debugger event arrives.
      const derived = await cdp.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
        expression: `(async () => { const { observeInitialExecutionIdentity } = await ${page.native ? '__nativePartitionFixture.importModule' : 'import'}(${JSON.stringify(identityUrl)}); return observeInitialExecutionIdentity(${JSON.stringify(observation.resolvedRuntimeSession)}); })()` });
      assert(!derived.exceptionDetails, JSON.stringify(derived.exceptionDetails));
      const initialExecutionIdentity = derived.result.value;
      assert(initialExecutionIdentity, 'Observed session did not produce an execution identity');
      const scriptId = scripts.get(identityUrl);
      assert(scriptId, 'Executed identity helper was not observed');
      const helper = await cdp.send('Debugger.getScriptSource', { scriptId });
      assert.equal(hash(helper.scriptSource), identityHash, 'Executed identity helper differs from installed archive');
      return { ...observation, initialExecutionIdentity,
        observation: 'CDP actual loaded resident handle, before resident session creation',
        sources: { factory: { url: factoryUrl, sha256: factoryHash }, identity: { url: identityUrl, sha256: identityHash } } };
    },
    async close() {
      await pausedWork;
      try { await cdp.send('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId }); }
      finally { await cdp.detach(); }
    }
  };
}
