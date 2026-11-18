/**
 * Tool calling on a real GPU provider, through the stock OpenAI client: installed native delivery, one
 * provider that loads the model, a requester with the authenticated text API, the TLS coordinator and its
 * credit ledger, all on this machine.
 *
 *   REPLOID_FLEET_PHYSICAL=1 node tests/fixtures/tool-call-physical.js /absolute/operator/tool-call.json
 *
 * It proves three things on real inference: a setting changed after the quote is refused before the
 * provider generates; the output constraint forces tokens the model would not have chosen; the output
 * limit ends generation with the expected terminal reason. Operator paths, tokens and keys stay in the
 * private configuration. Every process here is started and stopped by this script.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import OpenAI from 'openai';

if (process.env.REPLOID_FLEET_PHYSICAL !== '1') throw Error('Explicit physical opt-in required');
const config = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const root = config.stateDirectory, pkg = JSON.parse(await fs.readFile(config.packageReceipt, 'utf8'));
if (!path.isAbsolute(root)) throw Error('Absolute state directory required');
await fs.mkdir(root, { recursive: true, mode: 0o700 });
const from = file => import(pathToFileURL(path.join(pkg.directory, file)));
const { openFleetCredits } = await from('server/fleet/credits.js');
const { startFleetService } = await from('server/fleet/service.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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
const model = structuredClone(config.model);
if (model.toolCallFormat !== 'reploid.tool-call/hermes-v1') throw Error('The model entry must declare the tool-call format this fixture exercises');
const token = randomBytes(32).toString('hex'), apiSecret = randomBytes(32).toString('hex'), room = 'reploid-swarm-fleet-tools-' + randomUUID();
const certificate = await fs.readFile(config.coordinator.certFile, 'utf8');
const report = { schema: 'reploid.tool-call-physical/v1', startedAt: new Date().toISOString(), package: pkg, passed: false,
  model: { id: model.id, modelDigest: model.identity, outputCeiling: model.generation.maxTokens }, checks: {}, evidence: {} };
const reportFile = path.join(root, 'tool-call-physical.json');
const save = () => fs.writeFile(reportFile, JSON.stringify(report, null, 2));

// ---- Local processes: one native fleet host each, spoken to on standard input. ----
async function launch(spec, extra) {
  const base = spec.releaseRoot, file = (...parts) => path.join(base, ...parts);
  await fs.mkdir(file('state'), { recursive: true }); await fs.mkdir(file('tls'), { recursive: true });
  await fs.writeFile(file('room.token'), token, { mode: 0o600 }); await fs.writeFile(file('tls', 'cert.pem'), certificate);
  await fs.writeFile(file('host.json'), JSON.stringify({ schema: 'reploid.fleet-native/v1', roomId: room, signalingUrl: config.signalingUrl,
    origin: 'http://localhost:8000', maxOutputTokens: model.generation.maxTokens, serviceUrl: config.coordinator.url,
    computerId: spec.computerId, name: spec.name, identityFile: file('state', 'identity.json'), roomTokenFile: file('room.token'), ...extra }));
  const child = spawn(spec.node, [path.join(spec.codeRoot ?? file('reploid'), 'server', 'fleet', 'native-host.js'), file('host.json')],
    { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NODE_EXTRA_CA_CERTS: file('tls', 'cert.pem') } });
  const node = { spec, child, pending: new Map(), exited: false };
  const logFile = await fs.open(path.join(root, `${spec.computerId}.log`), 'a');
  createInterface({ input: child.stderr }).on('line', line => logFile.write(line + '\n'));
  node.ready = new Promise((resolve, reject) => {
    createInterface({ input: child.stdout }).on('line', line => {
      let value; try { value = JSON.parse(line); } catch { return; }
      if (value.ready) resolve(value);
      const waiting = value.id && node.pending.get(value.id);
      if (!waiting || 'delta' in value || value.event) return;
      node.pending.delete(value.id); value.error ? waiting.reject(Error(value.error)) : waiting.resolve(value.result);
    });
    child.on('exit', code => { node.exited = true; logFile.close(); reject(Error(`${spec.computerId} exited ${code}`));
      for (const waiting of node.pending.values()) waiting.reject(Error(`${spec.computerId} exited ${code}`)); node.pending.clear(); });
  });
  node.ready.catch(() => {});
  node.command = (op, body = {}) => new Promise((resolve, reject) => {
    const id = randomUUID(); node.pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, op, ...body }) + '\n');
  });
  node.stop = async () => {
    if (node.exited) return;
    child.stdin.end(); child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(15000)]);
    if (!node.exited) child.kill('SIGKILL');
  };
  node.identity = await Promise.race([node.ready, sleep(60000).then(() => { throw Error(spec.computerId + ' startup timed out'); })]);
  return node;
}
async function requesterHost(spec) {
  const secretFile = path.join(spec.releaseRoot, 'api.secret');
  await fs.mkdir(spec.releaseRoot, { recursive: true }); await fs.writeFile(secretFile, apiSecret, { mode: 0o600 });
  const node = await launch(spec, { textApi: { listenHost: '127.0.0.1', port: spec.textApiPort, tokenFile: secretFile },
    models: [{ model, mode: 'partition', ordered: null, directory: spec.modelDirectory }] });
  node.client = new OpenAI({ baseURL: `http://127.0.0.1:${spec.textApiPort}/v1`, apiKey: apiSecret, maxRetries: 0, timeout: 300000 });
  return node;
}

const nodes = [];
let credits = null, service = null;
const ADD = { type: 'function', function: { name: 'add', description: 'Add two integers and return their sum.',
  parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false } } };
const MULTIPLY = { type: 'function', function: { name: 'multiply', description: 'Multiply two integers and return their product.',
  parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'], additionalProperties: false } } };
const timed = async work => { const started = performance.now(); const value = await work(); return { value, ms: Math.round(performance.now() - started) }; };
const outcome = async work => { try { return { value: await work() }; } catch (error) { return { error: { status: error.status ?? null, message: error.message } }; } };
const heldBy = id => credits.snapshot().accounts.find(row => row.id === id).held;

try {
  // 1. Processes, then the ledger and coordinator for exactly their identities.
  const provider = await launch(config.provider, { cacheDirectory: config.provider.cacheDirectory,
    models: [{ model, mode: 'whole-model', ordered: null, directory: config.provider.modelDirectory }] });
  nodes.push(provider);
  const requester = await requesterHost(config.requester); nodes.push(requester);
  // A second requester whose code is altered to change one setting after the quote is accepted.
  const altered = path.join(config.tamperedRequester.releaseRoot, 'reploid-altered');
  await fs.rm(altered, { recursive: true, force: true });
  await fs.cp(await fs.realpath(path.join(config.requester.releaseRoot, 'reploid')), altered, { recursive: true, verbatimSymlinks: true });
  const meshFile = path.join(altered, 'packages', 'reploid', 'src', 'mesh', 'peer-generation.js'), source = await fs.readFile(meshFile, 'utf8');
  const anchor = '        ...(settings ? { settings: snapshotJson(settings) } : {})\n      };\n';
  if (source.split(anchor).length !== 2) throw Error('The altered requester could not be prepared: the payload statement moved');
  await fs.writeFile(meshFile, source.replace(anchor, anchor
    + '      if (requestPayload.settings) requestPayload.settings = { ...requestPayload.settings, maxOutputTokens: requestPayload.settings.maxOutputTokens + 1 };\n'));
  const tampered = await requesterHost({ ...config.tamperedRequester, codeRoot: altered }); nodes.push(tampered);

  const enrolled = nodes.map(node => ({ id: node.spec.computerId, name: node.spec.name, ownerId: 'owner',
    providers: [{ participantId: node.identity.participantId, publicJwk: node.identity.publicJwk }] }));
  credits = await openFleetCredits({ file: path.join(root, `tool-credits-${randomUUID()}.sqlite`), computers: enrolled,
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'tool-call-physical/1', unit: 'noncash-service-credit', creditsPerOutputToken: 1,
      maxDebt: 100000, maxOutputTokens: model.generation.maxTokens, maxPendingPerComputer: 8, maxClockSkewMs: 30000, maxRequestMs: 300000,
      allowSameOwner: true, wholeModelTerminalCharge: 0 } });
  service = await startFleetService({ credits, port: config.coordinator.port, listenHost: config.coordinator.listenHost, models: [model],
    tls: { key: await fs.readFile(config.coordinator.keyFile), cert: certificate },
    placementPolicy: { maxMeasurementAgeMs: 86400000, maxObservationAgeMs: 600000, minResidencyMs: 1, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });

  const loaded = await timed(() => provider.command('select', { index: 0, contribute: true }));
  for (const node of [requester, tampered]) await node.command('select', { index: 0, contribute: false });
  log('provider-loaded', { ms: loaded.ms });
  for (const node of [requester, tampered]) {
    await until(async () => (await node.command('state')).execution?.models?.some(row => row.id === model.id && !row.partition
      && row.availability === 'ready' && row.generationSettings?.tools === true), 120000, 'a ready provider that advertises tools');
  }
  const state = await provider.command('state');
  report.evidence.provider = { adapter: state.hardware?.adapter ?? null, loadMs: loaded.ms };
  const chat = (node, body) => node.client.chat.completions.create({ model: model.id, ...body });

  // 2. A complete round trip through the stock client, not streamed and streamed.
  const question = { role: 'user', content: 'What is 17 plus 25? Use the add tool.' };
  const trips = [];
  for (const stream of [false, true]) {
    const first = await timed(async () => {
      if (!stream) return (await chat(requester, { messages: [question], tools: [ADD], tool_choice: 'required' })).choices[0];
      const calls = []; let finish = null;
      for await (const chunk of await chat(requester, { messages: [question], tools: [ADD], tool_choice: 'required', stream: true })) {
        const choice = chunk.choices?.[0]; if (!choice) continue;
        for (const part of choice.delta?.tool_calls ?? []) {
          calls[part.index] ??= { id: part.id, type: 'function', function: { name: '', arguments: '' } };
          if (part.function?.name) calls[part.index].function.name += part.function.name;
          if (part.function?.arguments) calls[part.index].function.arguments += part.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      return { finish_reason: finish, message: { role: 'assistant', content: null, tool_calls: calls } };
    });
    const call = first.value.message.tool_calls?.[0], args = call ? JSON.parse(call.function.arguments) : null;
    const valid = first.value.finish_reason === 'tool_calls' && first.value.message.tool_calls.length === 1 && call.function.name === 'add'
      && Number.isInteger(args.a) && Number.isInteger(args.b);
    const sum = valid ? args.a + args.b : null;
    const second = valid ? await outcome(() => chat(requester, { tools: [ADD], tool_choice: 'none', messages: [question,
      { role: 'assistant', content: null, tool_calls: first.value.message.tool_calls }, { role: 'tool', tool_call_id: call.id, content: String(sum) }] })) : null;
    trips.push({ stream, callMs: first.ms, call: call ?? null, arguments: args, valid, toolResult: sum,
      answer: second?.value?.choices[0].message.content ?? null, answerError: second?.error ?? null,
      answerMentionsResult: typeof second?.value?.choices[0].message.content === 'string' && second.value.choices[0].message.content.includes(String(sum)) });
    log('round-trip', trips.at(-1));
  }
  report.evidence.roundTrips = trips;
  report.checks.roundTripValidCallAndAnswer = trips.every(row => row.valid && typeof row.answer === 'string' && row.answer.length > 0);
  report.checks.modelUsedTheToolResult = trips.every(row => row.answerMentionsResult);

  // 3. The constraint forces tokens the model would not have chosen.
  const plain = { role: 'user', content: 'Reply with the single word hello. Do not call any tool.' };
  const product = { role: 'user', content: 'Multiply 6 by 7. Use the multiply tool.' };
  const step = async body => { const run = await timed(() => outcome(() => chat(requester, body))); const choice = run.value.value?.choices?.[0] ?? null;
    return { ms: run.ms, error: run.value.error ?? null, finishReason: choice?.finish_reason ?? null, content: choice?.message?.content ?? null,
      call: choice?.message?.tool_calls?.[0] ?? null, usage: run.value.value?.usage ?? null }; };
  const integers = call => { try { const args = JSON.parse(call.function.arguments); return Number.isInteger(args.a) && Number.isInteger(args.b); } catch { return false; } };
  const free = await step({ messages: [plain], tools: [ADD], tool_choice: 'none' });
  const forced = await step({ messages: [plain], tools: [ADD], tool_choice: 'required' });
  const preferred = await step({ messages: [product], tools: [ADD, MULTIPLY], tool_choice: 'required' });
  const named = await step({ messages: [product], tools: [ADD, MULTIPLY], tool_choice: { type: 'function', function: { name: 'add' } } });
  report.evidence.constraint = { samePromptUnconstrained: free, samePromptForced: forced, twoToolsModelChoice: preferred, twoToolsForcedToAdd: named,
    note: 'Timings are single requests on one machine; the constrained request disables several of Doppler\'s fast paths.' };
  report.checks.unconstrainedAnswersInText = typeof free.content === 'string' && free.content.length > 0 && !free.call;
  report.checks.maskForcesAValidCall = forced.finishReason === 'tool_calls' && forced.call?.function.name === 'add' && integers(forced.call);
  report.checks.maskBlocksThePreferredTool = preferred.call?.function.name === 'multiply' && named.call?.function.name === 'add' && integers(named.call);
  log('constraint', { free: free.content ?? free.error, forced: forced.call ?? forced.error, preferred: preferred.call?.function.name ?? preferred.error, named: named.call?.function.name ?? named.error });

  // 4. The output limit reaches the sampler and gives the expected terminal reason.
  const counting = { role: 'user', content: 'Count from one to thirty, one number per line.' };
  const capped = await chat(requester, { messages: [counting], max_completion_tokens: 5 });
  const cutCall = await chat(requester, { messages: [question], tools: [ADD], tool_choice: 'required', max_completion_tokens: 4 });
  report.evidence.outputLimit = { text: { finishReason: capped.choices[0].finish_reason, usage: capped.usage, content: capped.choices[0].message.content },
    call: { finishReason: cutCall.choices[0].finish_reason, usage: cutCall.usage, toolCalls: cutCall.choices[0].message.tool_calls ?? null, content: cutCall.choices[0].message.content } };
  report.checks.capStopsTextAtTheLimit = capped.choices[0].finish_reason === 'length' && capped.usage.completion_tokens === 5;
  report.checks.capCutsACallWithNothingExecutable = cutCall.choices[0].finish_reason === 'length' && !cutCall.choices[0].message.tool_calls?.length
    && cutCall.usage.completion_tokens === 4;

  // 4b. Anthropic Messages, streamed on the whole-model route: the stream opens with the provider's real
  // input count before the answer is complete, and the count agrees with the one signed at the end.
  const messagesStream = await fetch(`http://127.0.0.1:${config.requester.textApiPort}/v1/messages`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiSecret, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: model.id, max_tokens: model.generation.maxTokens, stream: true, messages: [counting] }) });
  const events = [], decoder = new TextDecoder(); let buffered = '', firstDeltaAt = null; const streamStarted = performance.now();
  for await (const piece of messagesStream.body) {
    buffered += decoder.decode(piece, { stream: true });
    for (let cut = buffered.indexOf('\n\n'); cut >= 0; cut = buffered.indexOf('\n\n')) {
      const data = buffered.slice(0, cut).split('\n').find(line => line.startsWith('data: ')); buffered = buffered.slice(cut + 2);
      if (!data) continue;
      const event = JSON.parse(data.slice(6)); events.push(event);
      if (event.type === 'content_block_delta' && firstDeltaAt === null) firstDeltaAt = Math.round(performance.now() - streamStarted);
    }
  }
  const opened = events.find(event => event.type === 'message_start'), closing = events.find(event => event.type === 'message_delta');
  const deltas = events.filter(event => event.type === 'content_block_delta').length;
  report.evidence.messagesStream = { status: messagesStream.status, openingInputTokens: opened?.message?.usage?.input_tokens ?? null,
    closingUsage: closing?.usage ?? null, stopReason: closing?.delta?.stop_reason ?? null, textDeltas: deltas, firstDeltaMs: firstDeltaAt,
    totalMs: Math.round(performance.now() - streamStarted), error: events.find(event => event.type === 'error') ?? null };
  report.checks.messagesStreamsIncrementallyWithTheRealInputCount = messagesStream.status === 200 && !report.evidence.messagesStream.error
    && Number.isInteger(opened?.message?.usage?.input_tokens) && opened.message.usage.input_tokens > 0 && deltas > 1
    && firstDeltaAt < report.evidence.messagesStream.totalMs;

  // 5. A setting changed after the quote is refused before the provider generates.
  const before = credits.snapshot().journal.length, requestsBefore = new Set(credits.snapshot().journal.map(row => row.request_id));
  const refused = await outcome(() => chat(tampered, { messages: [counting], max_completion_tokens: 6 }));
  const control = await outcome(() => chat(requester, { messages: [counting], max_completion_tokens: 6 }));
  const afterState = await provider.command('state');
  report.evidence.changedSetting = { alteredRequester: refused.error ?? { unexpectedlyAnswered: refused.value?.choices?.[0]?.message?.content ?? null },
    unalteredControl: control.error ?? { finishReason: control.value.choices[0].finish_reason, usage: control.value.usage },
    ledgerEntriesAdded: credits.snapshot().journal.length - before,
    settledRequestsAdded: [...new Set(credits.snapshot().journal.map(row => row.request_id))].filter(id => !requestsBefore.has(id)).length,
    alteredRequesterHold: heldBy(config.tamperedRequester.computerId), alteredRequesterBalance: credits.snapshot().accounts.find(row => row.id === config.tamperedRequester.computerId).balance,
    providerActiveAfter: afterState.activeRequests };
  report.checks.changedSettingRefused = Boolean(refused.error);
  report.checks.changedSettingNeverCharged = report.evidence.changedSetting.alteredRequesterBalance === 0;
  report.checks.sameRequestUnalteredSucceeds = !control.error && control.value.choices[0].finish_reason === 'length';

  const snapshot = credits.snapshot();
  report.ledger = { balances: Object.fromEntries(snapshot.accounts.map(row => [row.id, { balance: row.balance, held: row.held }])),
    journalEntries: snapshot.journal.length, sumOfBalances: snapshot.accounts.reduce((sum, row) => sum + row.balance, 0) };
  report.passed = Object.values(report.checks).every(Boolean);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.failure = error.stack; process.exitCode = 1; log('failed', { error: String(error) });
} finally {
  report.finishedAt = new Date().toISOString();
  await save().catch(() => {});
  for (const node of nodes) await node.stop().catch(() => {});
  await service?.close(); credits?.close();
  log('finished', { passed: report.passed, report: reportFile, checks: report.checks });
}
