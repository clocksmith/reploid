#!/usr/bin/env node
/**
 * Scoring rollout, real processes: one matched pair on this checkout, and this checkout against an OLDER release in
 * both directions, before any standing host is upgraded (docs/scoring-rollout.md).
 *
 *   node tests/fixtures/scoring-rollout/run.js --old-root OLD_CHECKOUT [--out NEW_DIRECTORY] [--case 1,2,3,4] [--directory full|own]
 *
 * OLD_CHECKOUT is the release the standing hosts run, checked out with its own `npm ci` (git worktree add --detach).
 * What is real: separate operating-system processes for the ledger service (this checkout's server/fleet/service.js,
 * SQLite, a coordinator key made beforehand), the signaling server and every host; each host is the fleet native host
 * of ITS checkout (host.js), with its own key file, WebRTC, its credit client and its own transport codec and frame
 * registry. What is not: every key belongs to one operator on one machine, and the model is scripted (no weights, no
 * GPU), so the score is deterministic.
 *
 * Cases:
 *   1  new requester -> new provider: the Daily turn and its score complete; admission, signed records, receipt and
 *      settlement; the outsider's records-only verifier reproduces the debit and the payout; no hold left.
 *   2  new requester -> old provider: the Daily turn completes without a score; the old provider's received frames hold
 *      no scoring frame at all; no scoring reservation and no hold.
 *   3  old requester -> new provider: the old Daily path sends its one-shot receipt-bound score request; the new
 *      provider refuses it without running anything; the turn completes without a score; no hold.
 *   4  new requester, one old and one new provider in one room: an operation granted to the old one is refused before
 *      anything is held or sent; Daily pinned to each one scores only on the new one; the old one receives no scoring frame.
 *
 * Writes OUT/report.json (and each host's frame log and the outsider's files). Exit code 0 only when every case passed.
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
import { tradeKey } from '../../../scripts/settlement/trade.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const hostScript = path.join(repo, 'tests/fixtures/scoring-rollout/host.js');
const run = promisify(execFile);
const POLICY = { schema: 'reploid.service-credit-policy/v1', version: 'scoring-rollout/1', unit: 'noncash-service-credit', creditsPerOutputToken: 2,
  maxDebt: 512, maxOutputTokens: 16, maxPendingPerComputer: 4, maxClockSkewMs: 3000, maxRequestMs: 20000, allowSameOwner: false, wholeModelTerminalCharge: 0,
  wholeModelUnclaimedReleaseMs: 8000, partitionUnclaimedReleaseMs: 8000, maxUnacknowledgedOutputs: 4 };
const SCORING_FRAMES = ['reploid:mesh-operation-request', 'reploid:target-score-request'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const ownerFile = async (file, text) => { await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await fs.writeFile(file, text, { mode: 0o600 }); };
const commitOf = async root => (await run('git', ['-C', root, 'rev-parse', '--short=9', 'HEAD'])).stdout.trim();

async function start(name, args, { cwd, log, port = null }) {
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = [], events = [], replies = new Map(), ready = Promise.withResolvers(), errors = [];
  createInterface({ input: child.stdout }).on('line', line => {
    lines.push(line);
    let value = null;
    try { value = JSON.parse(line); } catch { return; }
    if (value?.ready === true) ready.resolve(value);
    if (value?.event) events.push(value);
    if (value?.id && replies.has(value.id)) { replies.get(value.id).resolve(value); replies.delete(value.id); }
  });
  createInterface({ input: child.stderr }).on('line', line => { if (!/ExperimentalWarning|trace-warnings|SQLite is an experimental/.test(line)) errors.push(line); });
  child.once('exit', code => ready.reject(Error(`${name} exited with ${code} before it was ready: ${errors.slice(-5).join(' | ')}`)));
  ready.promise.catch(() => {});
  if (port) (async () => {
    for (let attempt = 0; attempt < 200 && child.exitCode === null; attempt++) {
      const open = await new Promise(resolve => { const socket = net.connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
      if (open) return ready.resolve({ ready: true });
      await sleep(100);
    }
  })();
  const startedAs = await Promise.race([ready.promise, sleep(60000).then(() => { throw Error(`${name} was not ready in 60 s: ${errors.slice(-5).join(' | ')}`); })]);
  log(`started ${name} (pid ${child.pid})`);
  return { name, child, lines, events, errors, startedAs,
    command(value, timeoutMs = 90000) {
      const id = randomUUID(), reply = Promise.withResolvers(); replies.set(id, reply);
      child.stdin.write(JSON.stringify({ id, ...value }) + '\n');
      return Promise.race([reply.promise, sleep(timeoutMs).then(() => { throw Error(`${name} did not answer ${value.op}`); })]).then(answer => {
        if (answer.error) throw Error(`${name} ${value.op}: ${answer.error}`);
        return answer.result;
      });
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), sleep(10000).then(() => child.kill('SIGKILL'))]);
    } };
}

export async function runScoringRollout({ oldRoot, out = null, cases = [1, 2, 3, 4], directory = 'full', print = line => console.log(line) }) {
  const root = out ? path.resolve(out) : await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-scoring-rollout-'));
  await fs.mkdir(root, { recursive: true });
  if ((await fs.readdir(root)).length) throw Error(`${root} is not empty; name a new directory`);
  const transcript = [], processes = [];
  const log = line => { const entry = `${new Date().toISOString()} ${line}`; transcript.push(entry); print(entry); };
  const dir = name => path.join(root, name);
  const versions = { new: { root: repo, commit: await commitOf(repo) }, old: { root: path.resolve(oldRoot), commit: await commitOf(oldRoot) } };
  const report = { schema: 'reploid.scoring-rollout-run/v1', label: 'One operator, one machine, keys made for this run, a scripted model and no GPU.',
    versions: { new: versions.new.commit, old: versions.old.commit }, ledgerDirectory: directory, startedAt: new Date().toISOString(), policy: POLICY, cases: [], ok: false };
  const { DatabaseSync } = await import('node:sqlite');
  try {
    log(`new = ${versions.new.commit} (${versions.new.root}); old = ${versions.old.commit} (${versions.old.root})`);
    const manifest = JSON.stringify({ note: 'scoring-rollout manifest; no weights', nonce: randomUUID() });
    const model = { id: 'scoring-rollout-scripted-model', identity: 'sha256:' + createHash('sha256').update(manifest).digest('hex'), provider: 'doppler', generation: { maxTokens: 16 } };
    await fs.writeFile(path.join(root, 'manifest.json'), manifest);
    const [servicePort, signalingPort] = [await freePort(), await freePort()];
    const serviceUrl = `http://127.0.0.1:${servicePort}/v1/fleet`;
    const signalingUrl = `ws://127.0.0.1:${signalingPort}/signaling`;

    const parties = {};
    for (const role of ['requester-new', 'requester-old', 'provider-new', 'provider-old']) {
      const { identity } = await tradeKey({ state: dir(role), name: role });
      parties[role] = { role, account: `${role}-account`, computerId: `${role}-computer`, participantId: identity.peerId, publicJwk: identity.publicJwk,
        version: role.endsWith('-old') ? 'old' : 'new' };
      if (role.startsWith('provider')) { await fs.mkdir(path.join(dir(role), 'weights'), { recursive: true }); await fs.writeFile(path.join(dir(role), 'weights', 'manifest.json'), manifest); }
      else { await fs.mkdir(path.join(dir(role), 'model'), { recursive: true }); await fs.writeFile(path.join(dir(role), 'model', 'manifest.json'), manifest); }
    }
    log(`keys: ${Object.values(parties).map(party => `${party.role} ${party.participantId}`).join(', ')}`);

    const coordinatorKeyFile = path.join(dir('ledger'), 'coordinator-key.json');
    await fs.mkdir(dir('ledger'), { recursive: true, mode: 0o700 });
    const made = JSON.parse((await run(process.execPath, [path.join(repo, 'server/fleet/coordinator-key.js'), 'create', coordinatorKeyFile])).stdout);
    const publication = JSON.parse((await run(process.execPath, [path.join(repo, 'scripts/settlement/trade.js'), 'coordinator-fingerprint', '--key', coordinatorKeyFile, '--ledger', serviceUrl])).stdout);
    await fs.writeFile(path.join(dir('ledger'), 'enrollment.json'), JSON.stringify(Object.values(parties).map(party => ({ id: party.computerId, name: party.role,
      ownerId: party.account, providers: [{ participantId: party.participantId, publicJwk: party.publicJwk }] })), null, 2));
    await fs.writeFile(path.join(dir('ledger'), 'models.json'), JSON.stringify([model], null, 2));
    const databaseFile = path.join(dir('ledger'), 'credits.sqlite');
    await fs.writeFile(path.join(dir('ledger'), 'service.json'), JSON.stringify({ schema: 'reploid.fleet-service/v1', enrollmentFile: path.join(dir('ledger'), 'enrollment.json'),
      modelsFile: path.join(dir('ledger'), 'models.json'), databaseFile, creditPolicy: POLICY, coordinatorKeyFile,
      placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 },
      directory, listenHost: '127.0.0.1', port: servicePort }, null, 2));
    const begin = async (name, args, options) => { const started = await start(name, args, { ...options, log }); processes.push(started); return started; };
    const ledger = await begin('ledger service (new)', [path.join(repo, 'server/fleet/service.js'), path.join(dir('ledger'), 'service.json')], { cwd: repo });
    if (ledger.startedAs.coordinatorId !== made.coordinatorId) throw Error('The ledger service did not start with the configured coordinator key');
    await begin('signaling server (new)', [path.join(repo, 'server/reploid-signaling.js'), '--port', String(signalingPort)], { cwd: repo, port: signalingPort });

    /** The ledger's own rows, read from its database file: every account's held credits and every request's state. */
    const ledgerRows = () => {
      const db = new DatabaseSync(databaseFile, { readOnly: true });
      try {
        return { accounts: db.prepare('SELECT id, balance, held FROM fleet_accounts ORDER BY id').all().map(row => ({ ...row })),
          requests: db.prepare('SELECT id, state, binding FROM fleet_requests').all().map(row => {
            const binding = JSON.parse(row.binding);
            return { id: row.id, state: row.state, operation: binding.operation ?? 'generate', consumer: binding.consumer,
              providers: (binding.providers ?? []).map(provider => provider.participantId) };
          }) };
      } finally { db.close(); }
    };

    const outsider = dir('outsider');
    await fs.mkdir(path.join(outsider, 'independent'), { recursive: true });
    await fs.copyFile(path.join(repo, 'scripts/settlement/verify-records.js'), path.join(outsider, 'verify-records.js'));
    await fs.copyFile(path.join(repo, 'scripts/settlement/independent/replay.js'), path.join(outsider, 'independent/replay.js'));
    await fs.writeFile(path.join(outsider, 'coordinator-key.json'), JSON.stringify(await (await fetch(`${serviceUrl}/coordinator`)).json(), null, 2));
    const verify = async (name, trade) => {
      const file = `${name}.json`;
      await fs.writeFile(path.join(outsider, file), JSON.stringify(trade, null, 2) + '\n');
      const result = await run(process.execPath, ['verify-records.js', file, '--coordinator-key', 'coordinator-key.json', '--coordinator-fingerprint', publication.fingerprint, '--json'], { cwd: outsider })
        .then(value => ({ code: 0, stdout: value.stdout }), error => ({ code: error.code, stdout: error.stdout ?? '' }));
      let verdict = null;
      try { verdict = JSON.parse(result.stdout); } catch { /* reported below */ }
      const facts = verdict?.attempts?.[0]?.facts ?? {};
      return { file, exit: result.code, ok: verdict?.ok === true, status: facts.status ?? null, debit: facts.debit ?? null, payouts: facts.payouts ?? null,
        holdRemaining: facts.hold?.remaining ?? null, holdBasis: facts.hold?.basis ?? null,
        records: (trade.attempts?.[0]?.records ?? []).map(record => record.schema.replace(/^reploid\./, '')),
        problems: [...(verdict?.problems ?? []), ...(verdict?.attempts ?? []).flatMap(row => row.problems ?? [])] };
    };

    const hostConfig = async (party, roomId) => {
      const state = dir(party.role), roomTokenFile = path.join(root, `${roomId}.token`);
      const provider = party.role.startsWith('provider');
      const config = { schema: 'reploid.fleet-native/v1', computerId: party.computerId, name: party.role, identityFile: path.join(state, 'identity.json'),
        roomId, roomTokenFile, signalingUrl, serviceUrl, origin: 'http://localhost:8000', hostCandidatesOnly: true, maxOutputTokens: 16,
        tradeRecordsDirectory: path.join(state, 'trade-records'), daemon: true, initialModel: 0,
        ...(provider ? { models: [{ model, directory: path.join(state, 'weights'), mode: 'whole-model' }], initialContribution: true }
          : { models: [{ model, directory: path.join(state, 'model'), mode: 'partition', ordered: null }], initialContribution: false }) };
      const file = path.join(state, `host-${roomId}.json`);
      await ownerFile(file, JSON.stringify(config, null, 2) + '\n');
      return file;
    };
    const framesWhole = async file => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    // The report keeps what each frame was; the frame logs keep the recorded frames themselves.
    const frameRows = async file => (await framesWhole(file)).map(({ frame: _frame, ...row }) => row);
    const oldPeerTranscript = { schema: 'reploid.scoring-rollout-old-peer-transcript/v1', old: versions.old.commit, new: versions.new.commit,
      // The old release's receipt-bound scoring module: when it equals this checkout's, its requester code can be run from here.
      oldTargetScoringSha256: createHash('sha256').update(await fs.readFile(path.join(versions.old.root, 'packages/reploid/src/mesh/target-scoring.js'))).digest('hex'),
      label: 'Frames an old release sent to, and received from, the current one in a scripted one-operator run (tests/fixtures/scoring-rollout/run.js).' };
    /** Starts the named parties in one new room, each on its own checkout. */
    const room = async (label, roles) => {
      const roomId = `reploid-swarm-scoring-${label}-${randomUUID().slice(0, 8)}`;
      await ownerFile(path.join(root, `${roomId}.token`), randomBytes(32).toString('base64url'));
      const hosts = {};
      for (const role of roles) {
        const party = parties[role], frames = path.join(root, `frames-${label}-${role}.jsonl`);
        hosts[role] = await begin(`${role} host (${versions[party.version].commit})`, [hostScript, versions[party.version].root, await hostConfig(party, roomId), frames],
          { cwd: versions[party.version].root });
        hosts[role].frames = frames;
        hosts[role].party = party;
      }
      return { roomId, hosts, async close() { for (const host of Object.values(hosts).reverse()) await host.stop(); } };
    };
    const modelCalls = host => host.events.filter(event => event.event === 'model-call').map(event => event.operation);
    const noHold = rows => rows.accounts.every(account => account.held === 0);
    const settleWait = async (until = () => true, ms = 15000) => {
      const end = Date.now() + ms;
      for (;;) { const rows = ledgerRows(); if ((noHold(rows) && until(rows)) || Date.now() > end) return rows; await sleep(250); }
    };
    const record = row => { report.cases.push(row); log(`${row.ok ? 'PASS' : 'FAIL'} case ${row.case}: ${row.title}${row.ok ? '' : ` (${row.failed.join('; ')})`}`); };
    const checks = list => list.filter(([, ok]) => !ok).map(([name]) => name);

    const PROMPT = 'Say one two three.', TARGET = 'one two three';

    if (cases.includes(1)) {
      const { hosts, close } = await room('case1', ['provider-new', 'requester-new']);
      try {
        const requester = hosts['requester-new'], provider = hosts['provider-new'], providerId = parties['provider-new'].participantId;
        await requester.command({ op: 'wait-route', providerId });
        const before = ledgerRows();
        const daily = await requester.command({ op: 'daily', prompt: PROMPT, target: TARGET, providerId });
        const afterDaily = await settleWait();
        const scoring = afterDaily.requests.filter(row => !before.requests.some(old => old.id === row.id)).find(row => row.operation === 'scoreTargetSequence') ?? null;
        // The same operation asked directly, which names the reason when Daily (which never fails a turn on a score) has none.
        const direct = await requester.command({ op: 'operation', operation: 'scoreTargetSequence', payload: { messages: [{ role: 'user', content: PROMPT }], target: TARGET }, providerId });
        const after = await settleWait();
        await sleep(1500);
        const requesterTrade = scoring ? await requester.command({ op: 'trade', reservationId: scoring.id }) : null;
        const providerTrade = scoring ? await provider.command({ op: 'trade', reservationId: scoring.id }) : null;
        const outsiderRequester = requesterTrade ? await verify('case1-score-requester-copy', requesterTrade) : null;
        const outsiderProvider = providerTrade ? await verify('case1-score-provider-copy', providerTrade) : null;
        const frames = await frameRows(provider.frames);
        const scoringFrames = frames.filter(row => row.type === 'reploid:mesh-operation-request');
        const failed = checks([
          ['daily completed', daily.completed === true],
          ['score returned', Number.isSafeInteger(daily.score?.totalLogProbHundredths) && daily.score.totalLogProbHundredths === -33 && daily.score.tokenCount === 3],
          ['one scoring reservation, settled', scoring?.state === 'settled'],
          ['admission frame (no payload) before each payload frame', scoringFrames.map(row => row.carriesPayload).join() === 'false,true,false,true'],
          ['countersigned receipt frame', frames.some(row => row.type === 'reploid:mesh-operation-receipt')],
          ['direct operation completed with one acknowledged unit', direct.completed === true && direct.acknowledgedUnits === 1],
          ['provider ran each score once', modelCalls(provider).filter(call => call.includes('score')).length === 2],
          ['outsider (requester copy) settled, debit 2, payout 2', outsiderRequester?.ok && outsiderRequester.status === 'settled' && outsiderRequester.debit === 2
            && outsiderRequester.payouts?.['provider-new-account'] === 2 && outsiderRequester.holdRemaining === 0],
          ['outsider (provider copy) agrees', outsiderProvider?.ok && outsiderProvider.debit === 2 && outsiderProvider.payouts?.['provider-new-account'] === 2],
          ['no hold left', noHold(after)]]);
        record({ case: 1, title: 'matched pair, both on the new checkout', ok: failed.length === 0, failed, daily, direct, scoringReservation: scoring,
          providerFrames: frames.filter(row => row.type.startsWith('reploid:mesh-operation') || row.type === 'reploid:generation-request'),
          providerModelCalls: modelCalls(provider), outsider: { requesterCopy: outsiderRequester, providerCopy: outsiderProvider }, ledger: after });
      } finally { await close(); }
    }

    if (cases.includes(2)) {
      const { hosts, close } = await room('case2', ['provider-old', 'requester-new']);
      try {
        const requester = hosts['requester-new'], provider = hosts['provider-old'], providerId = parties['provider-old'].participantId;
        await requester.command({ op: 'wait-route', providerId });
        const before = ledgerRows();
        const daily = await requester.command({ op: 'daily', prompt: PROMPT, target: TARGET, providerId });
        const direct = await requester.command({ op: 'operation', operation: 'scoreTargetSequence', payload: { messages: [{ role: 'user', content: PROMPT }], target: TARGET }, providerId });
        const after = await settleWait();
        const fresh = after.requests.filter(row => !before.requests.some(old => old.id === row.id));
        await sleep(1000);
        const frames = await frameRows(provider.frames);
        const peers = await requester.command({ op: 'peers' });
        // What the old provider advertises, as this requester received it.
        oldPeerTranscript.oldProviderAdvertisement = (await framesWhole(requester.frames)).filter(row => row.type === 'reploid:peer-advertisement'
          && row.frame?.peerId === providerId).at(-1)?.frame ?? null;
        const failed = checks([
          ['daily turn completed', daily.completed === true],
          ['no score', daily.completed === true && daily.score === null],
          ['direct operation refused UNSUPPORTED_OPERATION', direct.completed === false && direct.error.code === 'UNSUPPORTED_OPERATION'],
          ['old provider received no scoring frame', !frames.some(row => SCORING_FRAMES.includes(row.type))],
          ['no scoring reservation', !fresh.some(row => row.operation !== 'generate')],
          ['old provider ran no score', !modelCalls(provider).some(call => call.includes('score'))],
          ['no hold left', noHold(after)]]);
        record({ case: 2, title: 'new requester -> old provider', ok: failed.length === 0, failed, daily, direct, requesterSees: peers,
          providerFrameTypes: [...new Set(frames.map(row => row.type))].sort(), providerScoringFrames: frames.filter(row => SCORING_FRAMES.includes(row.type)),
          providerModelCalls: modelCalls(provider), ledgerRequestsThisCase: fresh, ledger: after });
      } finally { await close(); }
    }

    if (cases.includes(3)) {
      const { hosts, close } = await room('case3', ['provider-new', 'requester-old']);
      try {
        const requester = hosts['requester-old'], provider = hosts['provider-new'], providerId = parties['provider-new'].participantId;
        await requester.command({ op: 'wait-route', providerId });
        const before = ledgerRows();
        const daily = await requester.command({ op: 'daily', prompt: PROMPT, target: TARGET, providerId });
        const after = await settleWait();
        const fresh = after.requests.filter(row => !before.requests.some(old => old.id === row.id));
        await sleep(1000);
        const frames = await frameRows(provider.frames), requesterFrames = await frameRows(requester.frames);
        // The old requester's score request as the new provider received it, and the answer the old requester received.
        oldPeerTranscript.oldRequesterScoreRequest = (await framesWhole(provider.frames)).find(row => row.type === 'reploid:target-score-request')?.frame ?? null;
        oldPeerTranscript.newProviderAnswerToOldRequester = (await framesWhole(requester.frames)).find(row => row.type === 'reploid:target-score-result')?.frame ?? null;
        const oldStyle = frames.filter(row => SCORING_FRAMES.includes(row.type));
        const answers = requesterFrames.filter(row => row.type === 'reploid:target-score-result' || row.type === 'reploid:mesh-operation-result');
        const failed = checks([
          ['daily turn completed', daily.completed === true],
          ['no score', daily.completed === true && daily.score === null],
          ['new provider ran nothing for the old request', !modelCalls(provider).some(call => call.includes('score'))],
          ['new provider answered with a refusal', answers.length > 0 && answers.every(row => row.answer?.error)],
          ['no scoring reservation', !fresh.some(row => row.operation !== 'generate')],
          ['no hold left', noHold(after)]]);
        record({ case: 3, title: 'old requester -> new provider', ok: failed.length === 0, failed, daily,
          providerReceivedScoringFrames: oldStyle, requesterReceivedAnswers: answers, providerModelCalls: modelCalls(provider), ledgerRequestsThisCase: fresh, ledger: after });
      } finally { await close(); }
    }

    if (cases.includes(4)) {
      const { hosts, close } = await room('case4', ['provider-old', 'provider-new', 'requester-new']);
      try {
        const requester = hosts['requester-new'], oldProvider = hosts['provider-old'], newProvider = hosts['provider-new'];
        const oldId = parties['provider-old'].participantId, newId = parties['provider-new'].participantId;
        await requester.command({ op: 'wait-route', providerId: oldId });
        await requester.command({ op: 'wait-route', providerId: newId });
        const before = ledgerRows();
        const toOld = await requester.command({ op: 'operation', operation: 'scoreTargetSequence', payload: { messages: [{ role: 'user', content: PROMPT }], target: TARGET }, providerId: oldId });
        const dailyOld = await requester.command({ op: 'daily', prompt: PROMPT, target: TARGET, providerId: oldId });
        const dailyNew = await requester.command({ op: 'daily', prompt: PROMPT, target: TARGET, providerId: newId });
        const after = await settleWait();
        const fresh = after.requests.filter(row => !before.requests.some(old => old.id === row.id));
        await sleep(1000);
        const oldFrames = await frameRows(oldProvider.frames), newFrames = await frameRows(newProvider.frames);
        const failed = checks([
          ['operation to the old provider refused before anything was held', toOld.completed === false && toOld.error.code === 'UNSUPPORTED_OPERATION' && !fresh.some(row => row.id === toOld.reservationId)],
          ['daily on the old provider: turn completes, no score', dailyOld.completed === true && dailyOld.score === null],
          ['daily on the new provider: turn and score complete', dailyNew.completed === true && dailyNew.score?.totalLogProbHundredths === -33],
          ['old provider received no scoring frame', !oldFrames.some(row => SCORING_FRAMES.includes(row.type))],
          ['new provider received admission then payload', newFrames.filter(row => row.type === 'reploid:mesh-operation-request').map(row => row.carriesPayload).join() === 'false,true'],
          ['exactly one scoring reservation, settled, on the new provider', fresh.filter(row => row.operation === 'scoreTargetSequence').length === 1
            && fresh.find(row => row.operation === 'scoreTargetSequence').state === 'settled' && fresh.find(row => row.operation === 'scoreTargetSequence').providers[0] === newId],
          ['no hold left', noHold(after)]]);
        record({ case: 4, title: 'mixed room: one old and one new provider', ok: failed.length === 0, failed, toOld, dailyOld, dailyNew,
          requesterSees: await requester.command({ op: 'peers' }), oldProviderScoringFrames: oldFrames.filter(row => SCORING_FRAMES.includes(row.type)),
          newProviderScoringFrames: newFrames.filter(row => row.type.startsWith('reploid:mesh-operation')), oldModelCalls: modelCalls(oldProvider), newModelCalls: modelCalls(newProvider),
          ledgerRequestsThisCase: fresh, ledger: after });
      } finally { await close(); }
    }
    if (Object.keys(oldPeerTranscript).length > 5) await fs.writeFile(path.join(root, 'old-peer-transcript.json'), JSON.stringify(oldPeerTranscript, null, 2) + '\n');
    report.finalLedger = ledgerRows();
    report.ok = report.cases.length === cases.length && report.cases.every(row => row.ok) && noHold(report.finalLedger);
    log(`final ledger: ${JSON.stringify(report.finalLedger.accounts)}`);
    log(report.ok ? 'SCORING ROLLOUT RUN: every case passed.' : 'SCORING ROLLOUT RUN: at least one case failed.');
  } catch (error) {
    log(`RUN ABORTED: ${error.stack ?? error.message}`);
    report.error = error.message;
    for (const item of processes) if (item.errors.length) log(`${item.name} stderr: ${item.errors.slice(-6).join(' | ')}`);
  } finally {
    for (const item of processes.reverse()) await item.stop().catch(() => {});
    report.finishedAt = new Date().toISOString();
    report.transcript = transcript;
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n').catch(() => {});
    print(`Report: ${path.join(root, 'report.json')}`);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = name => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? null : process.argv[at + 1] ?? null; };
  if (!flag('old-root')) { console.error('usage: run.js --old-root OLD_CHECKOUT [--out NEW_DIRECTORY] [--case 1,2,3,4] [--directory full|own]'); process.exit(2); }
  const report = await runScoringRollout({ oldRoot: flag('old-root'), out: flag('out'), cases: (flag('case') ?? '1,2,3,4').split(',').map(Number),
    directory: flag('directory') ?? 'full' });
  process.exitCode = report.ok ? 0 : 1;
}
