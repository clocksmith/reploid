#!/usr/bin/env node
/**
 * A ONE-OPERATOR REHEARSAL of the two-person trade on the charged route. It is not the trade.
 *
 *   node scripts/settlement/rehearsal.js [--out NEW_DIRECTORY] [--keep]
 *
 * What is real: four separate operating-system processes (the ledger service, a signaling server, a contributor host
 * and a requester host), each host with its own key file and its own data directory; the ledger service process with
 * a SQLite ledger and a coordinator key file made beforehand; WebRTC between the two hosts; credit reservation,
 * admission and settlement over the signed service; the signed settlement records and their disk stores; and the
 * requester host's browser bridge over HTTP, driven by the page's own bridge client module.
 *
 * What is not: both keys, the coordinator key and all four processes belong to one operator on one machine, so this
 * shows the mechanism and says nothing about two people. The contributor answers from a script (rehearsal-host.js):
 * no model, no weights, no GPU. No browser is opened; the page's bridge client is run from Node. The credit policy
 * uses a 20 second deadline and an 8 second release window so the silent-provider drill finishes in under a minute.
 *
 * It runs one completed trade and the three failure drills, restarts the requester host and exports from disk, then
 * checks every exported file as an outsider would: in a new directory that holds only the exported files, the
 * coordinator's public key fetched from the ledger service, and copies of the two verifier files.
 */
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createPrivateComputers } from '../../apps/poolday/host/private-computers.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { exportTrade as commandExport, prepareTradeHost, tradeKey } from './trade.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = promisify(execFile);
const ORIGIN = 'http://localhost:8000';
const POLICY = { schema: 'reploid.service-credit-policy/v1', version: 'one-operator-rehearsal/1', unit: 'noncash-service-credit', creditsPerOutputToken: 2,
  maxDebt: 64, maxOutputTokens: 16, maxPendingPerComputer: 4, maxClockSkewMs: 3000, maxRequestMs: 20000, allowSameOwner: false, wholeModelTerminalCharge: 0,
  wholeModelUnclaimedReleaseMs: 8000, partitionUnclaimedReleaseMs: 8000, maxUnacknowledgedOutputs: 4 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const ownerFile = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await fs.writeFile(file, text, { mode: 0o600 }); };

/** Starts one process and resolves once it prints a JSON line with `ready: true`. Its lines are kept for the transcript. */
async function start(name, script, args, { env = {}, log, port = null }) {
  const child = spawn(process.execPath, [path.join(repo, script), ...args], { cwd: repo, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [], replies = new Map(), ready = Promise.withResolvers();
  createInterface({ input: child.stdout }).on('line', line => {
    lines.push(line);
    let value = null;
    try { value = JSON.parse(line); } catch { /* not a JSON line */ }
    if (value?.ready === true) ready.resolve(value);
    if (value?.id && replies.has(value.id) && (Object.hasOwn(value, 'result') || Object.hasOwn(value, 'error'))) { replies.get(value.id).resolve(value); replies.delete(value.id); }
  });
  const errors = [];
  createInterface({ input: child.stderr }).on('line', line => { if (!/ExperimentalWarning|trace-warnings/.test(line)) errors.push(line); });
  child.once('exit', code => ready.reject(Error(`${name} exited with ${code} before it was ready: ${errors.slice(-5).join(' | ')}`)));
  ready.promise.catch(() => {});
  // A process that prints no ready line is up when its port accepts a connection.
  if (port) (async () => {
    for (let attempt = 0; attempt < 200 && child.exitCode === null; attempt++) {
      const open = await new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
      if (open) return ready.resolve({ ready: true });
      await sleep(100);
    }
  })();
  const startedAs = await Promise.race([ready.promise, sleep(45000).then(() => { throw Error(`${name} was not ready in 45 s: ${errors.slice(-5).join(' | ')}`); })]);
  log(`started ${name} as its own process (pid ${child.pid})`);
  return { name, child, lines, errors, startedAs,
    /** A host's owner command over its standard input. */
    command(value) {
      const id = randomUUID(), reply = Promise.withResolvers(); replies.set(id, reply);
      child.stdin.write(JSON.stringify({ id, ...value }) + '\n');
      return Promise.race([reply.promise, sleep(20000).then(() => { throw Error(`${name} did not answer ${value.op}`); })]).then(answer => {
        if (answer.error) throw Error(answer.error);
        return answer.result;
      });
    },
    async stop(signal = 'SIGTERM') {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill(signal);
      await Promise.race([once(child, 'exit'), sleep(10000).then(() => child.kill('SIGKILL'))]);
    } };
}

export async function runRehearsal({ out = null, keep = false, print = line => console.log(line) } = {}) {
  const root = out ? path.resolve(out) : await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-trade-rehearsal-'));
  await fs.mkdir(root, { recursive: true });
  if ((await fs.readdir(root)).length) throw Error(`${root} is not empty; name a new directory`);
  const transcript = [], processes = [];
  const log = line => { const entry = `${new Date().toISOString()} ${line}`; transcript.push(entry); print(entry); };
  const dir = name => path.join(root, name);
  let client = null;
  const report = { schema: 'reploid.trade-rehearsal/v1',
    label: 'ONE-OPERATOR REHEARSAL: one person, one machine, test keys, a scripted model and no GPU. It is not a trade between two people.',
    startedAt: new Date().toISOString(), policy: POLICY, drills: [], ok: false };
  try {
    log('ONE-OPERATOR REHEARSAL. One person runs every process on one machine with keys made for this run. Not the trade.');
    // The model's identity is the digest of a manifest file, as for a real model. Here the manifest describes nothing runnable.
    const manifest = JSON.stringify({ note: 'rehearsal manifest; no weights', nonce: randomUUID() });
    const model = { id: 'rehearsal-scripted-model', identity: 'sha256:' + createHash('sha256').update(manifest).digest('hex'), provider: 'doppler', generation: { maxTokens: 16 } };
    const roomId = 'reploid-swarm-rehearsal-' + randomUUID();
    const [servicePort, signalingPort, bridgePort] = [await freePort(), await freePort(), await freePort()];
    const serviceUrl = `http://127.0.0.1:${servicePort}/v1/fleet`;

    // Two key files in two directories, made before the ledger starts because its enrollment is fixed.
    const parties = {};
    for (const [role, account] of [['spender', 'spender-account'], ['earner', 'earner-account']]) {
      // The documented first step of each person: `trade.js key`.
      const { identity } = await tradeKey({ state: dir(role), name: role });
      parties[role] = { role, account, computerId: `${role}-computer`, participantId: identity.peerId, publicJwk: identity.publicJwk };
      await ownerFile(path.join(dir(role), 'room-token'), randomBytes(32).toString('base64url'));
    }
    // The earner holds the model's files (here only a manifest); the spender is handed the manifest and holds no weights.
    await fs.mkdir(path.join(dir('earner'), 'weights'), { recursive: true });
    await fs.writeFile(path.join(dir('earner'), 'weights', 'manifest.json'), manifest);
    await fs.writeFile(path.join(root, 'manifest.json'), manifest);
    await fs.writeFile(path.join(root, 'model.json'), JSON.stringify(model, null, 2));
    // One room, one shared token.
    await ownerFile(path.join(dir('earner'), 'room-token'), await fs.readFile(path.join(dir('spender'), 'room-token'), 'utf8'));
    log(`spender key ${parties.spender.participantId} in ${path.join('spender', 'identity.json')}; earner key ${parties.earner.participantId} in ${path.join('earner', 'identity.json')}`);

    // The coordinator key is made on purpose, with the documented command, before the ledger service starts.
    const coordinatorKeyFile = path.join(dir('ledger'), 'coordinator-key.json');
    await fs.mkdir(dir('ledger'), { recursive: true, mode: 0o700 });
    const made = JSON.parse((await run(process.execPath, [path.join(repo, 'server/fleet/coordinator-key.js'), 'create', coordinatorKeyFile])).stdout);
    log(`coordinator key made with coordinator-key.js create: ${made.coordinatorId}`);
    await fs.writeFile(path.join(dir('ledger'), 'enrollment.json'), JSON.stringify(Object.values(parties).map(party => ({ id: party.computerId, name: party.role,
      ownerId: party.account, providers: [{ participantId: party.participantId, publicJwk: party.publicJwk }] })), null, 2));
    await fs.writeFile(path.join(dir('ledger'), 'models.json'), JSON.stringify([model], null, 2));
    await fs.writeFile(path.join(dir('ledger'), 'service.json'), JSON.stringify({ schema: 'reploid.fleet-service/v1', enrollmentFile: path.join(dir('ledger'), 'enrollment.json'),
      modelsFile: path.join(dir('ledger'), 'models.json'), databaseFile: path.join(dir('ledger'), 'credits.sqlite'), creditPolicy: POLICY, coordinatorKeyFile,
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 },
      listenHost: '127.0.0.1', port: servicePort }, null, 2));


    const begin = async (name, script, args, options = {}) => { const started = await start(name, script, args, { ...options, log }); processes.push(started); return started; };
    const ledger = await begin('ledger service', 'server/fleet/service.js', [path.join(dir('ledger'), 'service.json')]);
    if (ledger.startedAs.coordinatorId !== made.coordinatorId) throw Error('The ledger service did not start with the configured coordinator key');
    await begin('signaling server', 'server/reploid-signaling.js', ['--port', String(signalingPort)], { port: signalingPort });
    // Each role's documented command checks the ledger (enrollment, account, model, coordinator key) and writes its
    // host configuration. Here the host it then starts is the scripted one.
    let bridgeToken = null;
    for (const role of ['earner', 'spender']) {
      const prepared = await prepareTradeHost({ role, state: dir(role), service: serviceUrl, signaling: `ws://127.0.0.1:${signalingPort}/signaling`, room: roomId,
        roomTokenFile: path.join(dir(role), 'room-token'), model, lan: true, bridgePort, pageOrigin: ORIGIN,
        ...(role === 'earner' ? { weights: path.join(dir(role), 'weights') } : { manifest: path.join(root, 'manifest.json') }) });
      if (prepared.status !== 'ready' || prepared.account !== parties[role].account || prepared.coordinator?.coordinatorId !== made.coordinatorId) throw Error(`trade.js ${role} did not find its enrollment or the coordinator key`);
      log(`trade.js ${role}: key enrolled as ${prepared.computerId}, account ${prepared.account}; records kept in ${path.join(role, 'trade-records')}`);
      if (role === 'spender') bridgeToken = (await fs.readFile(prepared.bridge.secretFile, 'utf8')).trim();
    }
    let earner = await begin('contributor host (earner)', 'scripts/settlement/rehearsal-host.js', [path.join(dir('earner'), 'host.json')]);
    let spender = await begin('requester host (spender)', 'scripts/settlement/rehearsal-host.js', [path.join(dir('spender'), 'host.json')]);

    // The page's side: its own bridge client module, over HTTP to the requester host's bridge, from this process.
    const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
    const connect = async () => {
      client?.close();
      client = createPrivateComputers({ storage: null, fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: ORIGIN } }) });
      for (let attempt = 0; ; attempt++) {
        try { await client.connect(bridgeUrl, bridgeToken); } catch (error) { if (attempt > 120) throw error; await sleep(500); continue; }
        if (client.models()[0]?.availability === 'ready') return;
        if (attempt > 120) throw Error('The contributor never became ready for the requester: ' + JSON.stringify(client.models()[0] ?? null));
        await sleep(500); await client.disconnect();
      }
    };
    await connect();
    log(`bridge paired over HTTP at 127.0.0.1; the contributor's model is ready for the requester`);

    const bridge = async (route, body = {}) => {
      const response = await fetch(bridgeUrl + route, { method: 'POST', headers: { Origin: ORIGIN, Authorization: `Bearer ${bridgeToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || `bridge ${route} answered ${response.status}`);
      return value;
    };
    const accounts = async () => Object.fromEntries((await bridge('/accounts')).accounts.map(row => [row.id, { balance: row.balance, held: row.held }]));
    /** One request from the page's client. Resolves `{ reservationId, text, result, error }` whatever way it ends. */
    const ask = async (prompt, { during = null } = {}) => {
      const controller = new AbortController(), attemptId = randomUUID();
      let reservationId = null, text = '';
      const outcome = client.execute({ threadId: 'rehearsal', attemptId, model: client.models()[0], messages: [{ role: 'user', content: prompt }],
        permissions: { sharingScope: 'mesh' }, privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] }, computation: 'plaintext' }),
        // This request must be answered by a contributor that signs the settlement records, or not sent at all.
        verifiableCharge: 'required' },
      { signal: controller.signal, requestApproval: async () => true,
        onState: state => { reservationId = state.execution?.serviceCredit?.id ?? reservationId; },
        onDelta: delta => { text += delta.text; } })
        .then(result => ({ result, error: null }), error => ({ result: null, error }));
      if (during) {
        // Wait until text is arriving, then do the drill's deliberate act.
        for (let waited = 0; !text && waited < 15000; waited += 50) await sleep(50);
        if (!text) throw Error('No text arrived before the drill\'s act');
        await during({ attemptId, controller });
      }
      const { result, error } = await outcome;
      reservationId ??= result?.serviceCredit?.id ?? error?.serviceCredit?.id ?? null;
      return { reservationId, text, result, error, attemptId };
    };
    /** Exports the records-only file through the bridge, retrying while the hold is still placed or the records are not final. */
    const exportTrade = async (reservationId, { waitMs = 0, want = () => true } = {}) => {
      const until = Date.now() + waitMs;
      for (;;) {
        const trade = await bridge('/trade', { id: reservationId, format: 'records' });
        if (trade.attempts?.[0]?.statement && want(trade) || Date.now() >= until) return trade;
        await sleep(1000);
      }
    };

    // The outsider's directory: nothing of this repository but the two verifier files, copied; the coordinator's
    // public key fetched from the ledger service, not taken from any trade file.
    const outsider = dir('outsider');
    await fs.mkdir(path.join(outsider, 'independent'), { recursive: true });
    await fs.copyFile(path.join(repo, 'scripts/settlement/verify-records.js'), path.join(outsider, 'verify-records.js'));
    await fs.copyFile(path.join(repo, 'scripts/settlement/independent/replay.js'), path.join(outsider, 'independent/replay.js'));
    const published = await (await fetch(`${serviceUrl}/coordinator`)).json();
    await fs.writeFile(path.join(outsider, 'coordinator-key.json'), JSON.stringify(published, null, 2));
    log(`outsider directory holds the two verifier files and the coordinator key fetched from the ledger service (${published.coordinatorId})`);
    const verify = async (name, trade) => {
      const file = `${name}.json`;
      await fs.writeFile(path.join(outsider, file), JSON.stringify(trade, null, 2) + '\n');
      const result = await run(process.execPath, ['verify-records.js', file, '--coordinator-key', 'coordinator-key.json', '--json'], { cwd: outsider })
        .then(value => ({ code: 0, stdout: value.stdout }), error => ({ code: error.code, stdout: error.stdout ?? '' }));
      let verdict = null;
      try { verdict = JSON.parse(result.stdout); } catch { /* reported below */ }
      const facts = verdict?.attempts?.[0]?.facts ?? {};
      return { file, exit: result.code, ok: verdict?.ok === true, status: facts.status ?? null, debit: facts.debit ?? null, payouts: facts.payouts ?? null,
        hold: facts.hold ? { basis: facts.hold.basis, placed: facts.hold.placed, released: facts.hold.released, remaining: facts.hold.remaining,
          releaseShown: facts.hold.releaseShown, byPublishedKey: facts.hold.keyChecked === true } : null,
        problems: [...(verdict?.problems ?? []), ...(verdict?.attempts ?? []).flatMap(row => row.problems)] };
    };
    const drill = async ({ name, what, expected, reservationId, trade, before }) => {
      const outsiderResult = await verify(name, trade);
      const after = await accounts();
      const row = { name, what, reservationId, label: trade.label ?? trade.schema, records: (trade.attempts?.[0]?.records ?? []).map(record => record.schema.replace(/^reploid\./, '')),
        statement: Boolean(trade.attempts?.[0]?.statement), outsider: outsiderResult, accountsBefore: before, accountsAfter: after, expected };
      row.ok = outsiderResult.ok && outsiderResult.exit === 0 && outsiderResult.status === expected.status && outsiderResult.debit === expected.debit
        && JSON.stringify(outsiderResult.payouts) === JSON.stringify(expected.payouts) && outsiderResult.hold?.basis === 'coordinator-signed'
        && outsiderResult.hold.releaseShown === true && outsiderResult.hold.byPublishedKey === true && outsiderResult.hold.remaining === 0
        && Object.values(after).every(account => account.held === 0);
      report.drills.push(row);
      log(`${row.ok ? 'PASS' : 'FAIL'} ${name}: outsider reads ${outsiderResult.status}, debit ${outsiderResult.debit}, payouts ${JSON.stringify(outsiderResult.payouts)}, `
        + `hold placed ${outsiderResult.hold?.placed} released ${outsiderResult.hold?.released} remaining ${outsiderResult.hold?.remaining} `
        + `(${outsiderResult.hold?.basis}${outsiderResult.hold?.byPublishedKey ? ', by the published coordinator key' : ''})`
        + (outsiderResult.problems.length ? `; problems: ${outsiderResult.problems.join('; ')}` : ''));
      return row;
    };

    // 1. A completed trade.
    let before = await accounts();
    const done = await ask('Count to three.');
    if (done.error) throw Error('The completed trade failed: ' + done.error.message);
    log(`trade: the page received "${done.text}"; the ledger charged ${done.result.execution.serviceCredit.charge} for ${done.result.execution.serviceCredit.outputTokens} output tokens`);
    await drill({ name: 'completed-trade', what: 'a completed answer, acknowledged', reservationId: done.reservationId, before,
      expected: { status: 'settled', debit: 3 * POLICY.creditsPerOutputToken, payouts: { 'earner-account': 3 * POLICY.creditsPerOutputToken } },
      trade: await exportTrade(done.reservationId, { waitMs: 10000 }) });

    // 2. The person stops mid-answer.
    before = await accounts();
    const stopped = await ask('[slow] Count to twelve.', { during: ({ controller }) => controller.abort() });
    log(`stop drill: the page had received "${stopped.text}" when the person stopped; the request ended with "${stopped.error?.message}"`);
    await drill({ name: 'drill-stop-mid-answer', what: 'the person stops mid-answer', reservationId: stopped.reservationId, before,
      expected: { status: 'settled', debit: 0, payouts: {} },
      // The provider's close, which claims nothing, reaches the requester just after the stop.
      trade: await exportTrade(stopped.reservationId, { waitMs: 15000, want: trade => trade.attempts[0].records.some(record => record.schema === 'reploid.stage-receipt/v1') }) });

    // 3. The provider fails and signs its fault.
    before = await accounts();
    const faulted = await ask('[fault] Count to three.');
    log(`fault drill: the page had received "${faulted.text}"; the request ended with "${faulted.error?.message}"`);
    await drill({ name: 'drill-provider-signed-fault', what: 'the provider fails and signs a fault', reservationId: faulted.reservationId, before,
      expected: { status: 'expired', debit: 0, payouts: {} }, trade: await exportTrade(faulted.reservationId, { waitMs: 15000 }) });

    // The requester host is restarted: what it exports afterwards comes from its disk.
    await spender.stop();
    log('requester host stopped (SIGTERM); its records are now only on its disk');
    spender = await begin('requester host (spender), restarted', 'scripts/settlement/rehearsal-host.js', [path.join(dir('spender'), 'host.json')]);
    await connect();
    const listed = (await bridge('/trades')).trades;
    log(`after the restart the requester host lists ${listed.length} reservations with records on disk`);
    before = await accounts();
    await drill({ name: 'completed-trade-after-requester-restart', what: 'the completed trade, exported from disk after the requester host restarted', reservationId: done.reservationId, before,
      expected: { status: 'settled', debit: 3 * POLICY.creditsPerOutputToken, payouts: { 'earner-account': 3 * POLICY.creditsPerOutputToken } },
      trade: await exportTrade(done.reservationId) });
    // The spender's documented export command, which reads the host's own settings and asks its bridge.
    const commanded = await commandExport({ state: dir('spender'), id: done.reservationId });
    if (JSON.stringify(commanded.trade.attempts[0].records) !== JSON.stringify((await exportTrade(done.reservationId)).attempts[0].records)) throw Error('trade.js export returned other records than the bridge');
    // The contributor's own copy of the same trade, from its own disk, over its owner command.
    const own = await earner.command({ op: 'trade', reservationId: done.reservationId, format: 'records' });
    await drill({ name: 'completed-trade-contributor-copy', what: 'the completed trade as the contributor host holds it on its own disk', reservationId: done.reservationId, before,
      expected: { status: 'settled', debit: 3 * POLICY.creditsPerOutputToken, payouts: { 'earner-account': 3 * POLICY.creditsPerOutputToken } }, trade: own });

    // 4. The provider is killed silently, and nobody signs anything more.
    before = await accounts();
    const silent = await ask('[slow] Count to twelve.', { during: async () => { earner.child.kill('SIGKILL'); await once(earner.child, 'exit'); log('contributor host killed with SIGKILL mid-answer'); } });
    log(`silent drill: the page had received "${silent.text}"; the request ended with "${silent.error?.message}"`);
    const early = await bridge('/trade', { id: silent.reservationId, format: 'records' });
    const earlyVerdict = await verify('drill-provider-killed-before-window', early);
    const heldNow = (await accounts())['spender-account'].held;
    log(`before the release window: ${heldNow} credits still held; the export is labelled "${early.label ?? early.schema}" and the outsider's check ${earlyVerdict.ok ? 'PASSES (wrong)' : 'does not pass'} (${earlyVerdict.problems[0] ?? 'no reason'})`);
    report.beforeWindow = { held: heldNow, label: early.label ?? early.schema, outsiderOk: earlyVerdict.ok, reason: earlyVerdict.problems[0] ?? null };
    const waitMs = POLICY.maxRequestMs + POLICY.partitionUnclaimedReleaseMs + POLICY.maxClockSkewMs + 5000;
    log(`waiting up to ${Math.round(waitMs / 1000)} s for the deadline plus the release window`);
    await drill({ name: 'drill-provider-killed-silently', what: 'the provider is killed and signs nothing; the hold is released at the deadline plus the release window', reservationId: silent.reservationId, before,
      expected: { status: 'expired', debit: 0, payouts: {} }, trade: await exportTrade(silent.reservationId, { waitMs }) });

    // The contributor comes back with the same key and data directory and still holds what it signed before it died.
    earner = await begin('contributor host (earner), restarted', 'scripts/settlement/rehearsal-host.js', [path.join(dir('earner'), 'host.json')]);
    const kept = await earner.command({ op: 'trades' });
    const survivor = kept.find(row => row.reservationId === silent.reservationId);
    log(`the restarted contributor host holds records for ${kept.length} reservations; for the one it died in: ${survivor ? `${survivor.records} records (terms, charge binding, its acceptance)` : 'none'}`);
    report.contributorAfterKill = { reservations: kept.length, recordsOfKilledAttempt: survivor?.records ?? 0 };

    // No prompt and no answer text in anything kept or exported: the stores of both hosts and the outsider's files.
    const kinds = [path.join(dir('spender'), 'trade-records'), path.join(dir('earner'), 'trade-records'), outsider];
    const leaked = [];
    for (const folder of kinds) {
      for (const name of await fs.readdir(folder)) {
        if (!name.endsWith('.json')) continue;
        const text = await fs.readFile(path.join(folder, name), 'utf8');
        if (/Count to|one two|\[slow\]|\[fault\]/.test(text)) leaked.push(path.join(path.basename(folder), name));
      }
    }
    report.promptOrAnswerTextFound = leaked;
    log(`prompt or answer text in the stored and exported files: ${leaked.length ? leaked.join(', ') : 'none'}`);
    const final = await accounts();
    report.finalAccounts = final;
    report.conserved = Object.values(final).reduce((sum, account) => sum + account.balance, 0) === 0;
    report.ok = report.drills.every(row => row.ok) && report.beforeWindow.outsiderOk === false && report.beforeWindow.held === POLICY.maxOutputTokens * POLICY.creditsPerOutputToken
      && report.conserved && report.contributorAfterKill.recordsOfKilledAttempt >= 3 && leaked.length === 0;
    log(`final accounts: ${JSON.stringify(final)}; no hold left: ${Object.values(final).every(account => account.held === 0)}`);
    log(report.ok ? 'REHEARSAL RESULT: every drill verified from the exported file and the published coordinator key alone. This was a one-operator rehearsal, not the trade.'
      : 'REHEARSAL RESULT: at least one check failed.');
  } catch (error) {
    log(`REHEARSAL ABORTED: ${error.message}`);
    report.error = error.message;
    for (const item of processes) if (item.errors.length) log(`${item.name} stderr: ${item.errors.slice(-4).join(' | ')}`);
    if (process.env.REPLOID_REHEARSAL_DEBUG) for (const item of processes) log(`${item.name} stdout: ${item.lines.slice(-3).map(line => line.slice(0, 300)).join(' | ')}`);
  } finally {
    client?.close();
    for (const item of processes.reverse()) await item.stop().catch(() => {});
    report.finishedAt = new Date().toISOString();
    report.transcript = transcript;
    await fs.writeFile(path.join(root, 'rehearsal.json'), JSON.stringify(report, null, 2) + '\n').catch(() => {});
    if (!keep && !out) await fs.rm(root, { recursive: true, force: true });
    else print(`Files kept in ${root} (keys made for this run are in it; delete it when done).`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1] ?? true; };
  const report = await runRehearsal({ out: typeof flag('out') === 'string' ? flag('out') : null, keep: Boolean(flag('keep')) });
  process.exitCode = report.ok ? 0 : 1;
}
