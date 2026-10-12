import { writeFile } from 'node:fs/promises';

// Operator-only physical test controller. Inspector stays on the host loopback.
const operation = process.argv[2];
const output = process.argv[3];
if (!['inspect', 'compute-off', 'compute-on', 'files-off', 'files-on', 'detach'].includes(operation) || !output) {
  throw Error('Explicit operation and receipt path required');
}
const targets = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const target = targets.find(row => row.url.endsWith('/server/native-participant.js'));
if (!target) throw Error('Expected native participant inspector not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let next = 0, paused, breakpoint;
const pending = new Map();
const pausedWaiters = [];
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Error(JSON.stringify(message.error))); else request.resolve(message.result);
  } else if (message.method === 'Debugger.paused') {
    paused = message.params;
    for (const resolve of pausedWaiters.splice(0)) resolve(paused);
  }
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`Inspector timeout: ${method}`)); }, 60000);
  pending.set(id, { resolve, reject, timer });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const snapshot = `({state:globalThis.__reploidNativeControl.getState(),files:globalThis.__reploidNativeControl.getFileState()})`;
const receipt = { startedAt: new Date().toISOString(), operation, targetUrl: target.url };
try {
  if (!await evaluate('Boolean(globalThis.__reploidNativeControl)')) {
    await call('Debugger.enable');
    breakpoint = (await call('Debugger.setBreakpointByUrl', {
      url: target.url, lineNumber: 323, columnNumber: 44
    })).breakpointId;
    const event = await Promise.race([
      new Promise(resolve => paused ? resolve(paused) : pausedWaiters.push(resolve)),
      new Promise((_, reject) => setTimeout(() => reject(Error('Native polling closure not observed')), 10000))
    ]);
    const exposed = await call('Debugger.evaluateOnCallFrame', {
      callFrameId: event.callFrames[0].callFrameId,
      expression: '(globalThis.__reploidNativeControl = participant, participant.identity)', returnByValue: true
    });
    if (exposed.exceptionDetails) throw Error(JSON.stringify(exposed.exceptionDetails));
    await call('Debugger.removeBreakpoint', { breakpointId: breakpoint }); breakpoint = null;
    await call('Debugger.resume'); paused = null;
    await call('Debugger.disable');
  }
  receipt.before = await evaluate(snapshot);
  if (operation !== 'inspect' && operation !== 'detach') {
    if (receipt.before.state.reservations?.active || receipt.before.state.unsettledOwners) {
      throw Error('Refusing to change contribution while another request owns resources');
    }
    const expression = {
      'compute-off': 'globalThis.__reploidNativeControl.stop()',
      'compute-on': 'globalThis.__reploidNativeControl.contribute(true)',
      'files-off': 'globalThis.__reploidNativeControl.stopSharing()',
      'files-on': 'globalThis.__reploidNativeControl.shareFiles(true)'
    }[operation];
    await evaluate(expression);
    await evaluate('globalThis.__reploidNativeControl.announceFiles()');
  }
  receipt.after = await evaluate(snapshot);
  if (operation === 'detach') {
    await evaluate("delete globalThis.__reploidNativeControl; setTimeout(() => process.getBuiltinModule('node:inspector').close(), 1000); true");
  }
  receipt.passed = true;
} catch (error) {
  receipt.passed = false; receipt.error = error.stack; process.exitCode = 1;
} finally {
  if (breakpoint) await call('Debugger.removeBreakpoint', { breakpointId: breakpoint }).catch(() => {});
  if (paused) await call('Debugger.resume').catch(() => {});
  await call('Debugger.disable').catch(() => {});
  socket.close();
  receipt.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ operation, passed: receipt.passed, error: receipt.error,
    phase: receipt.after?.state.phase, active: receipt.after?.state.reservations?.active,
    unsettled: receipt.after?.state.unsettledOwners, files: receipt.after?.files && { sharing: receipt.after.files.sharing, suppliedBytes: receipt.after.files.suppliedBytes, pending: receipt.after.files.pending, retainedFiles: receipt.after.files.retainedFiles, receiptCount: receipt.after.files.receipts?.length } }));
}
