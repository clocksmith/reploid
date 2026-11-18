/**
 * The whole-request journey on real machines: installed native delivery, real GPUs, WebRTC, the TLS coordinator
 * and its credit ledger. One requester that holds no weights for execution and several GPU providers, one of
 * which starts without the model and completes it from the others.
 *
 *   REPLOID_FLEET_PHYSICAL=1 node tests/fixtures/fleet-journey-physical.js /absolute/operator/journey.json
 *
 * Operator paths, hosts, tokens and keys stay in that private file. Every process here is started and stopped
 * by this driver; it changes nothing else on a machine. It deliberately kills provider processes it started.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';

if (process.env.REPLOID_FLEET_PHYSICAL !== '1') throw Error('Explicit physical opt-in required');
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const root = config.stateDirectory, pkg = JSON.parse(await fs.readFile(config.packageReceipt, 'utf8'));
if (!path.isAbsolute(root) || !Array.isArray(config.providers) || config.providers.length < 2) throw Error('Absolute state directory and at least two providers required');
if (config.requester.ssh) throw Error('The requester runs on this machine: the driver freezes and kills it by process id');
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const from = file => import(pathToFileURL(path.join(pkg.directory, file)));
const { openFleetCredits } = await from('server/fleet/credits.js');
const { startFleetService } = await from('server/fleet/service.js');
const { hashJson } = await from('packages/reploid/src/artifacts/signatures.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const activeNone = state => state.activeRequests === 0 && !['executing', 'draining'].includes(state.execution?.phase);
const log = (phase, value = {}) => console.log(JSON.stringify({ at: new Date().toISOString(), phase, ...value }));
async function until(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw Error('Timed out waiting for ' + label);
    await sleep(500);
  }
}
const model = structuredClone(config.model), messages = [{ role: 'user', content: config.prompt }];
const token = randomBytes(32).toString('hex'), room = 'reploid-swarm-fleet-journey-' + randomUUID();
const certificate = await fs.readFile(config.coordinator.certFile, 'utf8');
const report = { schema: 'reploid.fleet-journey-physical/v1', startedAt: new Date().toISOString(), package: pkg, passed: false,
  model: { id: model.id, modelDigest: model.identity, maxOutputTokens: model.generation.maxTokens }, prompt: config.prompt, nodes: {}, phases: {} };
const reportFile = path.join(root, 'journey-physical.json');
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2));

// ---- Processes. A node is one native fleet host: started here, spoken to on its standard input. ----
const sshArguments = (spec, code) => ['-o', 'BatchMode=yes', spec.ssh, spec.node, '-e',
  `"eval(Buffer.from('${Buffer.from(code).toString('base64')}','base64').toString())"`];
function run(command, args, input = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve(output) : reject(Error(`${command} exited ${code}`)));
    child.stdin.end(input ?? '');
  });
}
async function writeFiles(spec, files) {
  if (!spec.ssh) {
    for (const [file, value] of files) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, value, { mode: 0o600 }); }
    return;
  }
  await run('ssh', sshArguments(spec, "const fs=require('fs');let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>s+=c);"
    + "process.stdin.on('end',()=>{for(const [p,v] of JSON.parse(s)){fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,v,{mode:384})}});"),
  JSON.stringify(files));
}
const join = (spec, ...parts) => [spec.releaseRoot, ...parts].join('/');
function hostConfiguration(spec, role) {
  const common = { schema: 'reploid.fleet-native/v1', roomId: room, signalingUrl: config.signalingUrl, origin: 'http://localhost:8000',
    maxOutputTokens: model.generation.maxTokens, serviceUrl: config.coordinator.url, computerId: spec.computerId, name: spec.name,
    identityFile: join(spec, 'state', 'identity.json'), roomTokenFile: join(spec, 'room.token') };
  if (role === 'requester') return { ...common, rankProviders: spec.rankProviders === true,
    models: [{ model, mode: 'partition', ordered: null, directory: spec.modelDirectory }] };
  return { ...common, observationFile: join(spec, 'observation.json'), cacheDirectory: spec.cacheDirectory,
    ...(spec.ownerPolicyFile ? { ownerPolicyFile: spec.ownerPolicyFile } : {}),
    models: [{ model, mode: 'whole-model', ordered: null, directory: spec.modelDirectory,
      fillFromPeers: spec.fillFromPeers === true, shareModelFiles: spec.fillFromPeers !== true }] };
}
async function launch(spec, role) {
  await writeFiles(spec, [[join(spec, 'host.json'), JSON.stringify(hostConfiguration(spec, role))], [join(spec, 'room.token'), token],
    [join(spec, 'tls', 'cert.pem'), certificate]]);
  const entry = join(spec, 'reploid', 'server', 'fleet', 'native-host.js'), environment = { NODE_EXTRA_CA_CERTS: join(spec, 'tls', 'cert.pem'), ...(spec.env || {}) };
  // `hostCommand` replaces the plain node binary for the host process where a machine needs a loader or
  // library path in front of it; `node` still runs the small launcher.
  const hostCommand = Array.isArray(spec.hostCommand) && spec.hostCommand.length ? spec.hostCommand : [spec.node];
  const command = spec.gpuLockFile ? '/usr/bin/flock' : hostCommand[0];
  const args = [...(spec.gpuLockFile ? ['--shared', '--nonblock', spec.gpuLockFile, ...hostCommand] : hostCommand.slice(1)), entry, join(spec, 'host.json')];
  // The launcher refuses a delivery that differs from the packaged one, then reports the host's process id.
  const launcher = "const fs=require('fs');if(require('crypto').createHash('sha256').update(fs.readFileSync(" + JSON.stringify(join(spec, 'reploid', 'native-delivery.json'))
    + ")).digest('hex')!==" + JSON.stringify(pkg.manifestSha256) + ")throw Error('Installed delivery differs from the package');"
    + "const p=require('child_process').spawn(" + JSON.stringify(command) + "," + JSON.stringify(args) + ",{stdio:'inherit',env:{...process.env,..." + JSON.stringify(environment) + "}});"
    + "console.log(JSON.stringify({hostPid:p.pid}));p.on('exit',(c,s)=>process.exit(c??(s?1:0)));";
  const child = spec.ssh ? spawn('ssh', sshArguments(spec, launcher), { stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(spec.node, ['-e', launcher], { stdio: ['pipe', 'pipe', 'pipe'] });
  const node = { spec, role, child, pending: new Map(), fills: [], warnings: [], hostPid: null, exited: false };
  const logFile = await fs.open(path.join(root, `${spec.computerId}-${Date.now()}.log`), 'w');
  createInterface({ input: child.stderr }).on('line', line => {
    logFile.write(line + '\n');
    try {
      const value = JSON.parse(line);
      if (value.modelFill) node.fills.push({ at: Date.now(), ...value.modelFill });
      if (value.warning) node.warnings.push(value.warning);
    } catch { /* plain diagnostics stay in the log */ }
  });
  node.ready = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.hostPid) node.hostPid = value.hostPid;
      if (value.ready) resolve(value);
      const waiting = value.id && node.pending.get(value.id);
      if (!waiting) return;
      if ('delta' in value) waiting.onDelta?.(value.delta);
      else if (value.event) waiting.onEvent?.(value);
      else { node.pending.delete(value.id); clearTimeout(waiting.timer); value.error ? waiting.reject(Object.assign(Error(value.error), value)) : waiting.resolve(value.result); }
    });
    child.on('exit', code => {
      node.exited = true; logFile.close(); reject(Error(`${spec.computerId} exited ${code} before it was ready`));
      for (const waiting of node.pending.values()) { clearTimeout(waiting.timer); waiting.reject(Error(`${spec.computerId} exited ${code}`)); }
      node.pending.clear();
    });
  });
  node.ready.catch(() => {});
  node.command = (op, body = {}, { onDelta, onEvent, timeoutMs = 900000 } = {}) => new Promise((resolve, reject) => {
    const id = randomUUID(), timer = setTimeout(() => { node.pending.delete(id); reject(Error(`${spec.computerId} ${op} timed out`)); }, timeoutMs);
    node.pending.set(id, { resolve, reject, timer, onDelta, onEvent });
    child.stdin.write(JSON.stringify({ id, op, ...body }) + '\n');
  });
  /** Signals the host process itself, not the launcher or the SSH client. */
  node.signal = async signal => {
    if (!node.hostPid) throw Error('Host process id unknown for ' + spec.computerId);
    if (!spec.ssh) { process.kill(node.hostPid, signal); return; }
    const template = signal === 'SIGKILL' ? (spec.killCommand || 'kill -9 {pid}') : spec.signalCommands?.[signal];
    if (!template) throw Error(`${spec.computerId} has no command for ${signal}`);
    await run('ssh', ['-o', 'BatchMode=yes', spec.ssh, template.replace('{pid}', String(node.hostPid))]);
  };
  node.stop = async () => {
    if (node.exited) return;
    child.stdin.end();
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(20000)]);
    if (!node.exited) { await node.signal('SIGKILL').catch(() => {}); child.kill('SIGTERM'); report.forcedStops = [...(report.forcedStops || []), spec.computerId]; }
  };
  node.identity = await Promise.race([node.ready, sleep(spec.startupTimeoutMs ?? 60000).then(() => { throw Error(spec.computerId + ' startup timed out'); })]);
  return node;
}

const providers = [], byIdentity = new Map();
let requester = null, credits = null, service = null;
const nameOf = identity => byIdentity.get(identity) ?? identity;
const ledger = () => Object.fromEntries(credits.snapshot().accounts.map(row => [row.id, { balance: row.balance, held: row.held }]));
const requesterHold = () => ledger()[config.requester.computerId].held;

async function startRequester(rankProviders) {
  if (requester) await requester.stop();
  requester = await launch({ ...config.requester, rankProviders }, 'requester');
  await requester.command('select', { index: 0, contribute: false });
}
const readyProviders = async () => {
  const entry = (await requester.command('state')).execution?.models?.find(row => row.id === model.id && row.identity === model.identity && !row.partition && row.availability === 'ready');
  return entry ? { entry, identities: Object.values(entry.verifiedProviderIdentities || {}), count: entry.providerIds?.length ?? 0 } : null;
};
const waitForProviders = count => until(async () => { const seen = await readyProviders(); return seen && seen.count >= count ? seen : null; }, 180000, `${count} ready providers`);

// A shared machine is left alone if it comes under memory pressure: `pressure: { command, maxAvg10 }` on a
// provider names a command that prints /proc/pressure/memory, read before the run and between phases.
const deadline = Date.now() + (config.maxRunMinutes ?? 45) * 60000;
async function guard(phase) {
  if (Date.now() > deadline) throw Error(`Run exceeded its ${config.maxRunMinutes ?? 45}-minute limit before ${phase}`);
  for (const node of providers) {
    const check = node.spec.pressure;
    if (!check || node.exited) continue;
    const text = node.spec.ssh ? await run('ssh', ['-o', 'BatchMode=yes', node.spec.ssh, check.command]) : await run('/bin/sh', ['-c', check.command]);
    const avg10 = Number(/some avg10=([0-9.]+)/.exec(text)?.[1]);
    (report.pressure ??= []).push({ phase, computer: node.spec.computerId, avg10 });
    if (!(avg10 <= check.maxAvg10)) throw Error(`${node.spec.computerId} memory pressure ${avg10} exceeds ${check.maxAvg10} before ${phase}; stopping`);
  }
}

/** One attempt through the real requester. Never throws: the failure is part of the record. */
async function attempt(attemptId, { onFirstDelta = null } = {}) {
  const seen = await readyProviders();
  const record = { attemptId, text: '', deltaCount: 0, timeToFirstTokenMs: null, route: null, holdBefore: requesterHold() };
  if (!seen) { record.requesterSaw = { error: 'No ready provider' }; return record; }
  const started = performance.now(); let acting = null;
  try {
    const result = await requester.command('generate', { events: true,
      request: { threadId: randomUUID(), attemptId, model: seen.entry, messages } }, {
      onEvent: value => { if (value.event === 'route') record.route = { requestId: value.route.requestId, connectionId: value.route.providerId,
        provider: nameOf(value.route.recipientIdentity), providerIdentity: value.route.recipientIdentity }; },
      onDelta: delta => {
        const text = typeof delta === 'string' ? delta : delta?.text ?? '';
        record.deltaCount += 1; record.text += text;
        if (record.timeToFirstTokenMs !== null) return;
        record.timeToFirstTokenMs = Math.round(performance.now() - started);
        if (onFirstDelta) acting = onFirstDelta(record).catch(error => { record.actionError = error.message; });
      } });
    record.requesterSaw = { content: result.content, usage: result.usage };
    record.charge = result.serviceCredit?.charge ?? null; record.settlementStatus = result.serviceCredit?.status ?? 'completed';
    record.placement = result.execution?.placement ?? null; record.timing = result.execution?.timing ?? null; record.hardware = result.execution?.hardware ?? null;
    if (!record.route && result.execution?.providerIdentity) record.route = { provider: nameOf(result.execution.providerIdentity), providerIdentity: result.execution.providerIdentity };
  } catch (error) {
    record.requesterSaw = { error: error.message }; record.terminalReceipt = error.outcome ?? null;
    record.charge = error.serviceCredit?.charge ?? null; record.settlementStatus = error.serviceCredit?.status ?? null;
  }
  await acting;
  record.completionMs = Math.round(performance.now() - started);
  record.modelDigest = model.identity;
  record.routeDigest = record.route?.providerIdentity ? await hashJson({ schema: 'reploid.whole-model-route/v1', modelIdentity: model.identity,
    providerIdentity: record.route.providerIdentity, offerId: null }) : null;
  record.reservationId = record.route?.requestId ? `service:${requester.identity.participantId}:${record.route.requestId}` : null;
  record.partialOutputRetained = record.requesterSaw.error ? record.text : null;
  record.payloadBytes = { promptOut: Buffer.byteLength(JSON.stringify(messages)), answerIn: Buffer.byteLength(record.text) };
  record.holdAfter = requesterHold(); record.ledgerAfter = ledger();
  log('attempt', { attemptId, provider: record.route?.provider, firstTokenMs: record.timeToFirstTokenMs, completionMs: record.completionMs,
    saw: record.requesterSaw.error ?? 'answer', charge: record.charge });
  await save();
  return record;
}

/** The observation a provider publishes. `placeholder` steers calibration; real values replace it once measured. */
function observation(node, measured) {
  const budget = node.spec.maxGpuBytes, at = Date.now(), software = 'sha256:' + pkg.manifestSha256;
  return { id: node.spec.computerId, participantId: node.identity.participantId, softwareIdentity: software, observedAt: at, activeRequests: 0, resident: null,
    freeGpuBytes: budget, freeHostBytes: budget, maxStorageBufferBindingSize: node.spec.maxStorageBufferBindingSize ?? 2147483644,
    preferences: { enabled: true, models: [{ id: model.id, identity: model.identity }], maxGpuBytes: budget, maxHostBytes: budget },
    measurements: measured ? [{ modelIdentity: model.identity, mode: 'whole-model', stageIndex: null, planId: null, softwareIdentity: software, qualified: true,
      observedAt: at - 1, maxPromptTokens: 2048, maxOutputTokens: model.generation.maxTokens, loadMs: Math.max(1, Math.ceil(node.loadMs ?? 1)),
      requiredGpuBytes: 1, requiredHostBytes: 1, largestBindingBytes: 1, ...measured }] : [] };
}
async function publish(node, measured) {
  await writeFiles(node.spec, [[join(node.spec, 'observation.json'), JSON.stringify(observation(node, measured))]]);
  return node.command('reconcile');
}

try {
  // 1. Start every process, then open the ledger and the coordinator for exactly those identities.
  for (const spec of config.providers) { const node = await launch(spec, 'provider'); providers.push(node); byIdentity.set(node.identity.participantId, spec.computerId); }
  await startRequester(false);
  const enrolled = [requester, ...providers].map(node => ({ id: node.spec.computerId, name: node.spec.name, ownerId: 'owner',
    providers: [{ participantId: node.identity.participantId, publicJwk: node.identity.publicJwk }] }));
  const policy = { schema: 'reploid.service-credit-policy/v1', version: 'fleet-journey/1', unit: 'noncash-service-credit', creditsPerOutputToken: 1,
    maxDebt: 100000, maxOutputTokens: model.generation.maxTokens, maxPendingPerComputer: 8, maxClockSkewMs: 30000, allowSameOwner: true,
    wholeModelTerminalCharge: 0, maxRequestMs: config.creditPolicy.maxRequestMs, wholeModelUnclaimedReleaseMs: config.creditPolicy.wholeModelUnclaimedReleaseMs };
  credits = await openFleetCredits({ file: path.join(root, `journey-credits-${randomUUID()}.sqlite`), computers: enrolled, policy });
  service = await startFleetService({ credits, port: config.coordinator.port, listenHost: config.coordinator.listenHost, models: [model],
    tls: { key: await fs.readFile(config.coordinator.keyFile), cert: certificate },
    placementPolicy: { maxMeasurementAgeMs: 86400000, maxObservationAgeMs: 600000, minResidencyMs: 1, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  if (new URL(service.url).pathname !== new URL(config.coordinator.url).pathname) throw Error(`coordinator.url must be the address hosts use for this service: ${service.url.replace(/^https:\/\/[^/]+/, 'https://<host>:<port>')}`);
  report.policy = policy; report.computers = enrolled.map(row => ({ id: row.id, name: row.name }));

  await guard('loading');
  // 2. Providers that hold the model load it and offer its pieces. The one without it fills from them, then loads.
  const holders = providers.filter(node => node.spec.fillFromPeers !== true), filler = providers.find(node => node.spec.fillFromPeers === true);
  for (const node of holders) {
    const started = performance.now(); await node.command('select', { index: 0, contribute: true }); node.loadMs = performance.now() - started;
    log('provider-loaded', { computer: node.spec.computerId, ms: Math.round(node.loadMs) });
  }
  report.phases.discoveryBeforeFill = (await waitForProviders(holders.length)).identities.map(nameOf);
  if (filler) {
    const started = performance.now(); await filler.command('select', { index: 0, contribute: true }); filler.loadMs = performance.now() - started;
    const last = filler.fills.findLast(event => event.phase === 'complete') ?? filler.fills.at(-1) ?? null;
    report.phases.distribution = { provider: filler.spec.computerId, holders: holders.map(node => node.spec.computerId), fillAndLoadMs: Math.round(filler.loadMs),
      fetchedPieces: last?.fetchedPieces ?? null, fetchedBytes: last?.fetchedBytes ?? null, bySource: last?.sources ?? null,
      bySupplier: last?.suppliers ? Object.fromEntries(Object.entries(last.suppliers).map(([key, value]) => [nameOf(key), value])) : null,
      pieceEvents: filler.fills.filter(event => event.phase === 'piece').length, verified: 'every piece and file against the pinned identities, by the fill' };
    log('distribution', report.phases.distribution);
  }
  await waitForProviders(providers.length);

  await guard('calibration');
  // 3. Calibration. Ranking is on; one provider at a time is the only one with a published measurement, so the
  // coordinator's order steers the request to it. The placeholder rates are replaced by what was measured.
  await startRequester(true); await waitForProviders(providers.length);
  report.phases.calibration = [];
  for (const node of providers) {
    for (const other of providers) await publish(other, other === node ? { receipt: 'calibration-placeholder', prefillTokensPerSecond: 1, decodeTokensPerSecond: 1 } : null);
    const first = await attempt('calibrate-' + node.spec.computerId), state = await node.command('state');
    if (first.requesterSaw.error || first.route?.provider !== node.spec.computerId) throw Error(`Calibration did not reach ${node.spec.computerId}: ${JSON.stringify(first.requesterSaw)} via ${first.route?.provider}`);
    const usage = first.requesterSaw.usage, timing = first.timing;
    node.measured = { receipt: reportFile, prefillTokensPerSecond: timing?.prefillMs > 0 ? 1000 * usage.inputTokens / timing.prefillMs : 1000 * usage.inputTokens / Math.max(1, first.timeToFirstTokenMs),
      decodeTokensPerSecond: timing?.decodeMs > 0 ? 1000 * Math.max(1, usage.outputTokens - 1) / timing.decodeMs
        : 1000 * Math.max(1, usage.outputTokens - 1) / Math.max(1, first.completionMs - first.timeToFirstTokenMs),
      rateBasis: timing?.decodeMs > 0 ? 'provider-reported-timing' : 'requester-wall-clock' };
    node.reference = first.requesterSaw.content;
    report.nodes[node.spec.computerId] = { name: node.spec.name, adapter: state.hardware?.adapter ?? null, loadMs: Math.round(node.loadMs), measured: node.measured,
      peakGpuBufferBytes: state.hardware?.gpuBuffers?.peakBytes ?? null, processResidentBytes: state.hardware?.processResidentBytes ?? null, startedWithModel: node.spec.fillFromPeers !== true };
    report.phases.calibration.push(first);
  }
  for (const node of providers) { const { rateBasis: _basis, ...measured } = node.measured; await publish(node, measured); }
  const reference = providers[0].reference, correct = record => record.requesterSaw.content === reference;
  report.reference = { content: reference, sameOnEveryProvider: providers.every(node => node.reference === reference) };
  const fastest = [...providers].sort((a, b) => b.measured.decodeTokensPerSecond - a.measured.decodeTokensPerSecond)[0].spec.computerId;

  await guard('healthy');
  // 4. Healthy route with ranking off, then on, on the same providers.
  await startRequester(false); await waitForProviders(providers.length);
  report.phases.healthyRankingOff = await attempt('healthy-ranking-off');
  await startRequester(true); await waitForProviders(providers.length);
  report.phases.healthyRankingOn = await attempt('healthy-ranking-on');

  await guard('interruption');
  // 5. Interrupted: the chosen provider's process is killed right after its first streamed token.
  let killed = null, killedAt = null;
  const stopChosen = async record => {
    await until(() => record.route, 5000, 'the route of the streaming attempt');
    killed = providers.find(node => node.spec.computerId === record.route.provider); killedAt = Date.now();
    await killed.signal('SIGKILL');
  };
  report.phases.interrupted = await attempt('interrupted', { onFirstDelta: stopChosen });
  report.phases.interrupted.killedProvider = killed?.spec.computerId ?? null;

  await guard('recovery');
  // 6. Recovered: a fresh attempt on another provider. Then the killed provider returns and signs what happened.
  report.phases.recovered = await attempt('recovered');
  const heldWhileAway = requesterHold(), index = providers.indexOf(killed);
  providers[index] = Object.assign(await launch(killed.spec, 'provider'), { measured: killed.measured, loadMs: killed.loadMs, reference: killed.reference });
  const releasedAt = await until(() => requesterHold() === 0 ? Date.now() : null, 120000, 'hold release after the provider restarted');
  await providers[index].command('select', { index: 0, contribute: true });
  for (const node of providers) { const { rateBasis: _basis, ...measured } = node.measured; await publish(node, measured); }
  await waitForProviders(providers.length);
  const interruptedOutcome = await requester.command('recover', { input: { reservationId: report.phases.interrupted.reservationId, messages } });
  report.phases.interruptedRelease = { heldWhileProviderAway: heldWhileAway, releasedBy: 'the restarted provider signed failed-execution evidence',
    releasedMsAfterKill: releasedAt - killedAt, finalStatus: interruptedOutcome.status, finalCharge: interruptedOutcome.serviceCredit?.charge ?? null,
    gpuBuffers: 'released by the operating system when the process was killed; not separately measured' };

  await guard('lost-acknowledgment');
  // 7. Lost acknowledgment: the requester is frozen at the first token, the provider finishes and journals, then
  // the frozen requester is killed. A new requester process reconciles from the provider's journal.
  let frozenRoute = null;
  const lostAttempt = attempt('lost-acknowledgment', { onFirstDelta: async record => { await until(() => record.route, 5000, 'route'); frozenRoute = record.route; process.kill(requester.hostPid, 'SIGSTOP'); } });
  await until(() => frozenRoute, 120000, 'the first token of the lost-acknowledgment attempt');
  const serving = providers.find(node => node.spec.computerId === frozenRoute.provider), lostId = `service:${requester.identity.participantId}:${frozenRoute.requestId}`;
  await until(async () => activeNone(await serving.command('state')), 180000, 'the provider to finish the unacknowledged answer');
  await sleep(1000); process.kill(requester.hostPid, 'SIGKILL');
  const lost = await lostAttempt;
  const journalBefore = credits.snapshot().journal.length;
  await startRequester(true); await waitForProviders(providers.length);
  const first = await requester.command('recover', { input: { reservationId: lostId, messages, providerId: frozenRoute.connectionId } });
  const journalAfterFirst = credits.snapshot().journal.length;
  const second = await requester.command('recover', { input: { reservationId: lostId, messages, providerId: frozenRoute.connectionId } });
  report.phases.lostAcknowledgment = { provider: frozenRoute.provider, requesterSaw: lost.requesterSaw, deltasBeforeFreeze: lost.deltaCount,
    reconciliation: { first: { status: first.status, content: first.content ?? null, correct: first.content === reference, charge: first.serviceCredit?.charge ?? null },
      second: { status: second.status, charge: second.serviceCredit?.charge ?? null },
      ledgerEntriesAddedByFirst: journalAfterFirst - journalBefore, ledgerEntriesAddedBySecond: credits.snapshot().journal.length - journalAfterFirst } };
  log('lost-acknowledgment', report.phases.lostAcknowledgment.reconciliation);

  await guard('never-returns');
  // 8. A provider that never returns: killed after its first token and not restarted. The hold must stay until
  // the request deadline plus the claim window, then be released uncharged. This waits that long in real time.
  let abandoned = null;
  const never = await attempt('provider-never-returns', { onFirstDelta: async record => {
    await until(() => record.route, 5000, 'route'); abandoned = providers.find(node => node.spec.computerId === record.route.provider); await abandoned.signal('SIGKILL'); } });
  const holdBeforeWindow = requesterHold(), waitMs = policy.maxRequestMs + policy.wholeModelUnclaimedReleaseMs + 2000;
  log('waiting-for-claim-window', { ms: waitMs }); await sleep(waitMs);
  const holdAfterWindow = requesterHold();
  const expired = await requester.command('recover', { input: { reservationId: never.reservationId, messages } });
  report.phases.providerNeverReturns = { ...never, killedProvider: abandoned?.spec.computerId ?? null, holdBeforeWindow, holdAfterWindow, waitedMs: waitMs,
    afterWindow: { status: expired.status, charge: expired.serviceCredit?.charge ?? null, reason: expired.serviceCredit?.reason ?? null } };

  // 9. Ledger and verdict.
  const snapshot = credits.snapshot(), phases = report.phases;
  report.ledger = { balances: ledger(), journalEntries: snapshot.journal.length, sumOfBalances: snapshot.accounts.reduce((sum, row) => sum + row.balance, 0),
    openHolds: snapshot.accounts.reduce((sum, row) => sum + row.held, 0) };
  report.placementComparison = { fastestMeasured: fastest, rankingOff: { provider: phases.healthyRankingOff.route?.provider, completionMs: phases.healthyRankingOff.completionMs },
    rankingOn: { provider: phases.healthyRankingOn.route?.provider, reason: phases.healthyRankingOn.placement?.reason ?? null, completionMs: phases.healthyRankingOn.completionMs } };
  report.checks = { distributionFilled: !filler || phases.distribution.fetchedPieces > 0, sameAnswerOnEveryProvider: report.reference.sameOnEveryProvider,
    healthyCorrect: correct(phases.healthyRankingOff) && correct(phases.healthyRankingOn), rankedChoseFastest: phases.healthyRankingOn.route?.provider === fastest,
    interruptedKeptPartialAndUncharged: Boolean(phases.interrupted.requesterSaw.error) && phases.interrupted.deltaCount >= 1 && !phases.interrupted.charge,
    recoveredOnAnotherProvider: correct(phases.recovered) && phases.recovered.route?.provider !== phases.interrupted.route?.provider,
    interruptedHoldReleasedByReturn: phases.interruptedRelease.finalStatus === 'failed' && phases.interruptedRelease.finalCharge === 0,
    lostAcknowledgmentChargedOnce: phases.lostAcknowledgment.reconciliation.first.status === 'completed' && phases.lostAcknowledgment.reconciliation.first.correct
      && phases.lostAcknowledgment.reconciliation.ledgerEntriesAddedBySecond === 0,
    neverReturningHoldExpired: holdBeforeWindow > 0 && holdAfterWindow === 0 && expired.status === 'expired',
    ledgerConservedNoOpenHolds: report.ledger.sumOfBalances === 0 && report.ledger.openHolds === 0 };
  report.recoveryMode = 'restarted-generation';
  report.passed = Object.values(report.checks).every(Boolean);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1; log('failed', { error: String(error) });
} finally {
  report.finishedAt = new Date().toISOString();
  report.warnings = Object.fromEntries([requester, ...providers].filter(Boolean).map(node => [node.spec.computerId, node.warnings]));
  await save().catch(() => {});
  for (const node of [requester, ...providers].filter(Boolean)) await node.stop().catch(() => {});
  await service?.close(); credits?.close();
  await save().catch(() => {});
  log('finished', { passed: report.passed, report: reportFile, checks: report.checks ?? null });
}

