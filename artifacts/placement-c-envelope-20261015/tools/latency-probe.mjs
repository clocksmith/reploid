// Harness-side per-step timing for placement C, through existing debugger surfaces only: the stage 0
// coordinator page's DevTools protocol (Chrome, loopback 29671) and each native's loopback inspector
// (node --inspect, forwarded over ssh). It sets conditional breakpoints whose condition appends one
// [epoch ms, tag, ...values] row to a global array and always returns false, so execution never pauses
// and no served or installed byte changes. Every row is timestamped with performance.timeOrigin +
// performance.now() on that process's clock. Rows are drained to JSONL every few seconds; on SIGTERM or
// SIGINT the probe drains, removes every breakpoint, disables the debugger and deletes its array.
// Line numbers are those of Reploid 5610260a (the final-10 delivery); the files are byte-identical in the
// served bundle and the installed native package (sha256 prefixes recorded in the output).
// Usage: node latency-probe.mjs <out dir> <name>=<cdp http endpoint>[@<page url prefix>] ...
import fs from 'node:fs';
import path from 'node:path';

const [outDir, ...specs] = process.argv.slice(2);
if (!outDir || !specs.length) throw Error('Usage: latency-probe.mjs <out dir> <name>=<endpoint>[@<page prefix>] ...');
fs.mkdirSync(outDir, { recursive: true });

// [file regex, 1-based line, tag, values expression, optional guard expression]
const R = '(vendor/reploid|packages/reploid/src)/mesh/partitions/partition-route-execution\\.js(\\?.*)?$';
const P = '(vendor/reploid|packages/reploid/src)/mesh/partitions/partition-ordered-peer\\.js(\\?.*)?$';
const S = '(vendor/reploid|packages/reploid/src)/mesh/partitions/partition-step-receiver\\.js(\\?.*)?$';
const D = '(vendor/reploid|packages/reploid/src)/transport/partition-data-channel\\.js(\\?.*)?$';
const W = '(vendor/reploid|packages/reploid/src)/transport/bounded-channel-writer\\.js(\\?.*)?$';
const A = 'binding.attemptId.slice(0,8)';
const PEER = 'remoteParticipantId.slice(5,13)';
const POINTS = [
  // Coordinator route loop (partition-route-execution.js)
  [R, 130, 'r-perm-begin', `${A}, action`], [R, 133, 'r-perm-end', `${A}, action`],
  [R, 167, 'r-step-begin', `${A}, index`], [R, 171, 'r-permits-done', `${A}, index`],
  [R, 174, 'r-stage-begin', `${A}, index, stage`], [R, 179, 'r-call-start', `${A}, step.step, stage`],
  [R, 187, 'r-call-end', `${A}, step.step, stage`], [R, 190, 'r-lease-out', `${A}, index, stage`],
  [R, 191, 'r-calibrate', `${A}, index, stage`],
  [R, 204, 'r-ser-begin', `${A}, index, stage`], [R, 205, 'r-ser-end', `${A}, index, stage`],
  [R, 207, 'r-val-end', `${A}, index, stage`], [R, 208, 'r-clone-end', `${A}, index, stage`],
  [R, 209, 'r-xfer-begin', `${A}, index, stage`], [R, 212, 'r-xfer-end', `${A}, index, stage`],
  [R, 217, 'r-cmp-begin', `${A}, index, stage`], [R, 220, 'r-cmp-end', `${A}, index, stage`], [R, 221, 'r-edge-end', `${A}, index, stage`],
  [R, 223, 'r-final-begin', `${A}, index`], [R, 230, 'r-outperm-begin', `${A}, index`], [R, 232, 'r-outperm-end', `${A}, index`],
  [R, 243, 'r-delivery-end', `${A}, index`], [R, 246, 'r-pub-begin', `${A}, index`],
  [R, 247, 'r-pub-end', `${A}, index, JSON.stringify(steps.at(-1).stages)`],
  [R, 251, 'r-act-begin', `${A}, index`], [R, 253, 'r-act-end', `${A}, index`], [R, 256, 'r-step-end', `${A}, index`],
  // Ordered peer: coordinator stage port and native serving path (partition-ordered-peer.js)
  [P, 85, 'p-ex-begin', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 87, 'p-ex-doppler-begin', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 88, 'p-ex-doppler-end', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 168, 'p-so-begin', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 178, 'p-so-ret', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 207, 'p-sv-recv-begin', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 208, 'p-sv-recv-end', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 214, 'p-sv-final-ret', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 217, 'p-sv-ser-begin', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 220, 'p-sv-fp-begin', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 221, 'p-sv-so-begin', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 222, 'p-sv-so-end', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 223, 'p-sv-ret', 'metadata.identity.attemptId.slice(0,8), metadata.step, index'],
  [P, 328, 'p-pe-begin', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 333, 'p-pe-ser-begin', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 336, 'p-pe-ser-end', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 340, 'p-pe-req', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 341, 'p-pe-resp', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 345, 'p-pe-dec-begin', 'request.identity.attemptId.slice(0,8), request.step, index'],
  [P, 346, 'p-pe-dec-end', 'request.identity.attemptId.slice(0,8), request.step, index'],
  // Native step receiver (partition-step-receiver.js)
  [S, 196, 's-perm1-begin', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 197, 's-perm1-end', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 200, 's-fp-end', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 224, 's-perm2-begin', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 226, 's-exec-begin', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 227, 's-exec-end', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 239, 's-await-end', 'request.identity.attemptId.slice(0,8), request.step'],
  [S, 242, 's-perm3-end', 'request.identity.attemptId.slice(0,8), request.step'],
  // Data channel, both ends (partition-data-channel.js)
  [D, 63, 'd-perm-begin', `${PEER}, action, entry.id`], [D, 66, 'd-perm-end', `${PEER}, action, entry.id`],
  [D, 97, 'd-finish', `${PEER}, entry.id, !!error`],
  [D, 117, 'd-acc-begin', `${PEER}, frame.id, frame.metadata && frame.metadata.operation, frame.size`],
  [D, 135, 'd-ready-send', `${PEER}, entry.id`], [D, 141, 'd-acc-end', `${PEER}, entry.id`],
  [D, 150, 'd-exec-begin', `${PEER}, entry.id`], [D, 154, 'd-serve-begin', `${PEER}, entry.id, entry.metadata.operation`],
  [D, 155, 'd-serve-end', `${PEER}, entry.id`], [D, 157, 'd-result-send', `${PEER}, entry.id`], [D, 162, 'd-exec-end', `${PEER}, entry.id`],
  [D, 169, 'd-up-begin', `${PEER}, entry.id, entry.size`], [D, 184, 'd-up-end', `${PEER}, entry.id`],
  [D, 193, 'd-disc-begin', `${PEER}, entry.id`], [D, 194, 'd-disc-end', `${PEER}, entry.id`],
  [D, 202, 'd-ctrl-recv', `${PEER}, frame.type, frame.id, data ? 0 : 0`],
  [D, 218, 'd-ready-recv', `${PEER}, entry.id`], [D, 225, 'd-result-recv', `${PEER}, entry.id`],
  [D, 243, 'd-bin-complete', `${PEER}, id, entry.size`, 'entry.offset === entry.size'],
  [D, 264, 'd-req-new', `${PEER}, metadata.operation, metadata.step, bytes.length`],
  [D, 306, 'd-ctrl-send', `${PEER}, entry.id`], [D, 307, 'd-ctrl-sent', `${PEER}, entry.id`],
  // Channel writer: the moment each frame is handed to the RTC data channel
  [W, 39, 'w-send', 'channel.label, size, channel.bufferedAmount']
];
// d-ctrl-recv reads `data` from receiveControl(text): the parameter is named text there.
POINTS.find(row => row[2] === 'd-ctrl-recv')[3] = `${PEER}, frame.type, frame.id, text.length`;

const condition = (tag, values, guard) =>
  `(${guard ? `(${guard}) && ` : ''}globalThis.__plc && globalThis.__plc.push([performance.timeOrigin + performance.now(), ${JSON.stringify(tag)}, ${values}])), false`;

async function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(Error('CDP connection failed: ' + wsUrl)); });
  let id = 0; const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    }
  };
  socket.onclose = () => { for (const { reject } of pending.values()) reject(Error('CDP closed')); pending.clear(); };
  return { send: (method, params = {}) => new Promise((resolve, reject) => {
    const messageId = ++id; pending.set(messageId, { resolve, reject }); socket.send(JSON.stringify({ id: messageId, method, params }));
  }), close: () => socket.close() };
}

async function resolveTarget(spec) {
  const [name, rest] = spec.split(/=(.*)/s);
  const [endpoint, prefix] = rest.split('@');
  const list = await (await fetch(endpoint + '/json/list')).json();
  const target = prefix ? list.find(row => row.type === 'page' && row.url.startsWith(prefix)) : list[0];
  if (!target?.webSocketDebuggerUrl) throw Error('No debuggable target for ' + name);
  return { name, url: target.webSocketDebuggerUrl, title: target.title, type: target.type };
}

const targets = [];
const manifest = { schema: 'reploid.placement-c-latency-probe/v1', startedAt: new Date().toISOString(), targets: [] };
for (const spec of specs) {
  const target = await resolveTarget(spec);
  const client = await cdp(target.url);
  await client.send('Runtime.enable');
  await client.send('Debugger.enable');
  await client.send('Runtime.evaluate', { expression: 'globalThis.__plc = []; globalThis.__plcCalibration = performance.timeOrigin + performance.now(); true' });
  const breakpoints = [];
  for (const [file, line, tag, values, guard] of POINTS) {
    try {
      const result = await client.send('Debugger.setBreakpointByUrl', { urlRegex: file, lineNumber: line - 1, columnNumber: 0, condition: condition(tag, values, guard) });
      breakpoints.push({ tag, line, id: result.breakpointId, locations: result.locations.map(row => ({ line: row.lineNumber + 1, column: row.columnNumber })) });
    } catch (error) { breakpoints.push({ tag, line, error: error.message }); }
  }
  const out = fs.openSync(path.join(outDir, `${target.name}.jsonl`), 'a');
  const clock = await client.send('Runtime.evaluate', { expression: '[performance.timeOrigin, performance.now(), Date.now()]', returnByValue: true });
  targets.push({ ...target, client, breakpoints, out, rows: 0 });
  manifest.targets.push({ name: target.name, type: target.type, title: target.type === 'page' ? 'stage 0 coordinator page' : 'native inspector',
    clockAtArm: clock.result.value, breakpoints: breakpoints.map(({ id: _id, ...row }) => row) });
}
fs.writeFileSync(path.join(outDir, 'probe-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(JSON.stringify({ armed: targets.map(t => ({ name: t.name, set: t.breakpoints.filter(b => !b.error).length,
  resolved: t.breakpoints.filter(b => b.locations?.length).length, errors: t.breakpoints.filter(b => b.error).length })) }));

async function drain(target) {
  const result = await target.client.send('Runtime.evaluate', {
    expression: 'JSON.stringify([globalThis.__plc ? globalThis.__plc.splice(0) : null, performance.timeOrigin + performance.now()])', returnByValue: true });
  const [rows, at] = JSON.parse(result.result.value);
  if (rows) for (const row of rows) fs.writeSync(target.out, JSON.stringify(row) + '\n');
  target.rows += rows?.length || 0;
  return { rows: rows?.length || 0, at };
}
let stopping = false;
const timer = setInterval(() => { if (!stopping) Promise.all(targets.map(drain)).catch(error => console.error('drain', error.message)); }, 5000);
async function stop() {
  if (stopping) return; stopping = true; clearInterval(timer);
  const summary = [];
  for (const target of targets) {
    try {
      await drain(target);
      for (const row of target.breakpoints) if (row.id) await target.client.send('Debugger.removeBreakpoint', { breakpointId: row.id });
      await target.client.send('Runtime.evaluate', { expression: 'delete globalThis.__plc; delete globalThis.__plcCalibration; true' });
      await target.client.send('Debugger.disable');
      summary.push({ name: target.name, rows: target.rows, removed: target.breakpoints.filter(row => row.id).length });
    } catch (error) { summary.push({ name: target.name, error: error.message }); }
    fs.closeSync(target.out); target.client.close();
  }
  manifest.stoppedAt = new Date().toISOString(); manifest.summary = summary;
  fs.writeFileSync(path.join(outDir, 'probe-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(JSON.stringify({ stopped: summary }));
  process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
