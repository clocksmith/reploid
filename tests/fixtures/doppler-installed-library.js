// Exercise the installed Reploid provider against the same installed Doppler
// session as the application fixture. No private Doppler imports or GPU claims.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

export async function createInstalledLibraryOperationRunner(consumer, api) {
  const entry = name => execFileSync(process.execPath, ['--input-type=module', '-e',
    `process.stdout.write(import.meta.resolve(${JSON.stringify(name)}))`], { cwd: consumer, encoding: 'utf8' }).trim();
  const { createDopplerProvider } = await import(entry('reploid/doppler'));
  const { resolveConfig } = await import(entry('reploid/config'));
  return async ({ session, request, signal, adapterArtifactStore, onPartial }) => {
    const contract = Object.fromEntries(['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest'].map(key => [key, session[key]]));
    const config = resolveConfig({ overrides: { models: { providerId: 'doppler', contract } } });
    const provider = createDopplerProvider({ config, session, runtime: api, ownership: 'borrowed', toOperationRequest: () => request });
    try {
      return (await provider.generate([{ role: 'user', content: 'Adapter acceptance' }], onPartial,
        { signal, adapterArtifactStore })).evidence;
    } finally { await provider.close(); }
  };
}

export async function checkInstalledLibraryProvider({ consumer, api, session, makeRequest, formats }) {
  assert(Array.isArray(formats) && formats.length && formats.every(format => ['v1', 'v2'].includes(format)));
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const evidence = resolve(consumer, '../reploid-library');
  await mkdir(evidence, { recursive: true });
  const suppliedArchive = process.env.DOPPLER_TEST_REPLOID_ARCHIVE;
  let packed;
  if (suppliedArchive) {
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', suppliedArchive, 'package/package.json'], { encoding: 'utf8' }));
    assert.equal(metadata.name, 'reploid', 'Supplied consumer archive must contain the public Reploid package');
    const bytes = await readFile(suppliedArchive);
    packed = { filename: `reploid-${metadata.version}.tgz`, integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
    const target = resolve(evidence, packed.filename);
    if (resolve(suppliedArchive) !== target) await copyFile(suppliedArchive, target);
  } else {
    packed = JSON.parse(execFileSync('npm', ['pack', './packages/reploid', '--ignore-scripts', '--json',
      '--pack-destination', evidence], { cwd: root, encoding: 'utf8' }))[0];
  }
  const archive = resolve(evidence, packed.filename);
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps',
    '--no-save', '--package-lock=false', archive], { cwd: consumer, stdio: 'pipe' });
  const entry = name => execFileSync(process.execPath, ['--input-type=module', '-e',
    `process.stdout.write(import.meta.resolve(${JSON.stringify(name)}))`], { cwd: consumer, encoding: 'utf8' }).trim();
  const { createDopplerProvider } = await import(entry('reploid/doppler'));
  const { resolveConfig } = await import(entry('reploid/config'));
  const contract = Object.fromEntries(['modelId', 'capsuleId', 'semanticRoot', 'selectedTargetPlanDigest'].map(key => [key, session[key]]));
  contract.runtimeVersion = api.DOPPLER_VERSION;
  const config = resolveConfig({ overrides: { models: { providerId: 'doppler', contract } } });
  const requestFor = format => ({ ...makeRequest({ maxTokens: 3 }), schema: `doppler.capsule-operation-request/${format}` });
  const messages = [{ role: 'user', content: 'Installed provider generation' }];
  const checks = [];
  for (const format of formats) {
    const request = requestFor(format);
    let completed = false;
    let closed = 0;
    let receivedControl;
    let eventsSeen = 0;
    const observed = {
      ...session,
      async *executeOperation(input, control) {
        receivedControl = control;
        for await (const event of session.executeOperation(input, control)) {
          eventsSeen++;
          if (event.status === 'completed') completed = true;
          yield event;
        }
      },
      close() { closed++; }
    };
    const create = (extra = {}) => createDopplerProvider({ config, session: observed, ownership: 'borrowed', runtime: api,
      toOperationRequest: () => request, ...extra });
    const provider = create();
    const additions = [];
    const store = { readArtifact() { throw new Error('No adapter artifacts requested'); } };
    const result = await provider.generate(messages, async addition => {
      assert.equal(completed, format === 'v1', 'v2 must deliver text before completion; v1 preserves canonical decoding');
      additions.push(addition);
      await new Promise(resolve => setTimeout(resolve, 1));
    }, { adapterArtifactStore: store });
    assert.equal(receivedControl.adapterArtifactStore, store);
    assert.equal(additions.join(''), result.content);
    assert.equal(result.evidence.output.text, result.content);
    assert.equal(result.evidence.output.completion.stopReason, 'max-tokens');
    assert.equal(result.evidence.receipt.runtimeVersion, api.DOPPLER_VERSION);
    const collected = await provider.generate(messages);
    assert.deepEqual(collected.evidence.output, result.evidence.output);
    assert.equal(collected.evidence.receipt.outputHash, result.evidence.receipt.outputHash);
    checks.push(`${format}: installed streaming and collected results share verified completion`);

    const broken = transform => create({ session: { ...observed,
      async *executeOperation(input, control) {
        for await (const event of session.executeOperation(input, control)) {
          const changed = transform(event);
          if (changed) yield changed;
        }
      } } });
    await assert.rejects(broken(event => event.status === 'completed' ? null : event).generate(messages), /without completion/);
    await assert.rejects(broken(event => event.status === 'completed'
      ? { ...event, output: { ...event.output, text: 'corrupted' } } : event).generate(messages), /digest mismatch/);
    await assert.rejects(broken(event => ({ ...event, eventIndex: event.eventIndex + 1 })).generate(messages), /missing|reordered/);
    await assert.rejects(broken(async event => {
      if (event.status !== 'completed') return event;
      const { receiptDigest, ...receipt } = event.receipt;
      receipt.modelId = 'another-model';
      const { eventDigest, ...payload } = event;
      payload.receipt = { ...receipt, receiptDigest: await hashDopplerEvidence(receipt) };
      return { ...payload, eventDigest: await hashDopplerEvidence(payload) };
    }).generate(messages), /execution identity mismatch/);
    checks.push(`${format}: interruption, altered output and missing events rejected`);

    const cancelled = new AbortController();
    cancelled.abort(new Error('cancel before formatting'));
    let formatted = false;
    await assert.rejects(create({ toOperationRequest() { formatted = true; return request; } })
      .generate(messages, null, { signal: cancelled.signal }), /cancel before formatting/);
    assert.equal(formatted, false);
    if (format === 'v2') {
      const controller = new AbortController();
      let updates = 0;
      await assert.rejects(provider.generate(messages, () => { updates++; controller.abort(new Error('cancel streaming')); },
        { signal: controller.signal }), /cancel streaming/);
      assert.equal(updates, 1);
      let started;
      const callbackStarted = new Promise(resolve => { started = resolve; });
      const blocked = new AbortController();
      const waiting = provider.generate(messages, () => { started(); return new Promise(() => {}); }, { signal: blocked.signal });
      const rejected = assert.rejects(waiting, /cancel blocked consumer/);
      await callbackStarted;
      const before = eventsSeen;
      await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(eventsSeen, before, 'a slow callback must stop the next event pull');
      blocked.abort(new Error('cancel blocked consumer'));
      await rejected;
      await assert.rejects(provider.generate(messages, () => { throw new Error('consumer failed'); }), /consumer failed/);
      assert.equal((await provider.generate(messages)).content, result.content);
      checks.push('v2: cancellation and failed consumer release execution for the next request');
    }
    let releaseFormatter, started;
    const formatterStarted = new Promise(resolve => { started = resolve; });
    const pendingProvider = create({ toOperationRequest: () => new Promise(resolve => { releaseFormatter = resolve; started(); }) });
    const pending = pendingProvider.generate(messages);
    const rejected = assert.rejects(pending, /provider is closed/);
    await formatterStarted;
    await pendingProvider.close();
    await rejected;
    releaseFormatter(request);
    await provider.close();
    assert.equal(closed, 0, 'borrowed session remains owned by host');
    await assert.rejects(provider.generate(messages), /closed/);
    const owned = create({ ownership: 'owned' });
    await Promise.all([owned.close(), owned.close()]);
    assert.equal(closed, 1);
    checks.push(`${format}: close suppresses late setup; owned session closes once; borrowed session stays open`);
  }
  let executed = false;
  const incompatible = createDopplerProvider({ config, session: { ...session, executeOperation() { executed = true; } },
    ownership: 'borrowed', runtime: api,
    toOperationRequest: () => ({ ...requestFor('v1'), operation: { name: 'embed', version: 1 } }) });
  await assert.rejects(incompatible.generate(messages), /requires operation generate/);
  assert.equal(executed, false);
  if (typeof api.createCapsuleStreamAccumulator !== 'function') {
    const unsupported = createDopplerProvider({ config, session: { ...session, executeOperation() { executed = true; } },
      ownership: 'borrowed', runtime: api, toOperationRequest: () => requestFor('v2') });
    await assert.rejects(unsupported.generate(messages), /does not support operation v2/);
    assert.equal(executed, false);
    checks.push('published runtime rejects v2 before execution');
  }
  return { schema: 'reploid.installed-library-provider-test/v1', passed: true,
    runtimeVersion: api.DOPPLER_VERSION, formats, checks,
    archive: { path: archive, sha256: createHash('sha256').update(await readFile(archive)).digest('hex'), integrity: packed.integrity } };
}
