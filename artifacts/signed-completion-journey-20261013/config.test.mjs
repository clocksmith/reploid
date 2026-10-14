import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateConfig, validateRoom, privateAddressReason, redactPrivateAddresses, orderedSelectionId } from './config.mjs';
import { classifyRequest, compilePatterns, rangeBytes } from './observe.mjs';
import { freeze } from './test-fixtures.mjs';

const example = JSON.parse(fs.readFileSync(new URL('./config.example.json', import.meta.url)));
// Fabricated private-address shapes are assembled at runtime; no file carries one literally.
const tailnetHost = ['amd-host', 'tailnet-redacted', 'ts', 'net'].join('.');
const login = ['operator', 'amd-host'].join('@');

function filled() {
  const config = structuredClone(example);
  config.reportDirectory = '/var/tmp/reploid-journey-reports';
  config.application.roomFile = '/var/tmp/reploid-journey-room.json';
  config.freeze = structuredClone(freeze);
  const ports = { requester: 29680, coordinator: 29681, storageSupplier: 29682, storageAcquirer: 29683 };
  for (const [name, browser] of Object.entries(config.browsers)) {
    browser.origin = `http://127.0.0.1:${29670 + Object.keys(ports).indexOf(name)}/`;
    if (browser.connect.kind === 'launch') browser.connect.remoteDebuggingPort = ports[name];
    else browser.connect.endpoint = `http://127.0.0.1:${ports[name]}`;
  }
  config.contributorControl.module = '/var/tmp/reploid-contributor-control.mjs';
  config.modelFiles.pathPatterns = ['/manifest\\.json$', '-pieces\\.json$', '/config/model-(manifests|pieces)/'];
  return config;
}
function rejects(name, mutate, pattern) {
  test(`config rejects ${name}`, () => {
    const config = filled(); mutate(config);
    const { errors, config: accepted } = validateConfig(config);
    assert.equal(accepted, undefined);
    assert.match(errors.join('\n'), pattern);
  });
}

test('template keys match the schema and a filled template is accepted', () => {
  const { errors, config } = validateConfig(filled());
  assert.deepEqual(errors, []);
  assert.ok(Object.isFrozen(config) && Object.isFrozen(config.freeze.route[0]));
});
test('the unfilled template is rejected', () => {
  const { errors } = validateConfig(example);
  assert.ok(errors.some(error => /unfilled template placeholder/.test(error)));
  assert.ok(errors.length >= 10);
});
rejects('a missing field (no defaults)', config => { delete config.timeouts.answerMs; }, /missing answerMs/);
rejects('an unknown field', config => { config.observation.extra = 1; }, /unknown key extra/);
rejects('a host name origin', config => { config.browsers.requester.origin = 'http://example.invalid:8000/'; }, /loopback/);
rejects('a public signaling relay', config => { config.application.signalingUrl = 'wss://relay.example.invalid/swarm'; }, /loopback/);
rejects('a tailnet domain anywhere', config => { config.contributorControl.module = `/home/${tailnetHost}/control.mjs`; }, /tailnet domain/);
rejects('a login address anywhere', config => { config.freeze.route[1].orderedConfig = `/srv/${login}/stage.json`; }, /login address/);
rejects('a machine outside the three aliases', config => { config.browsers.storageAcquirer.machine = 'other-host'; }, /must be one of mac-host, amd-host, intel-host/);
rejects('a route that does not match the split layers', config => { config.freeze.route.pop(); delete config.freeze.nativeArtifacts['intel-host']; }, /stage count must equal splitLayers \+ 1/);
rejects('two stages on one machine', config => { config.freeze.route[2].machine = 'amd-host'; }, /distinct machine/);
rejects('a native stage 0', config => { config.freeze.route[0] = { ...config.freeze.route[1], index: 0, machine: 'mac-host', participantId: 'peer:' + '0'.repeat(24) }; }, /stage 0 coordinator/);
rejects('a CDP requester that cannot create separate profiles', config => {
  config.browsers.requester.connect = { kind: 'cdp', endpoint: 'http://127.0.0.1:29691' };
}, /requester\.connect\.kind: must be launch: independent requesters need separate user data directories/);
rejects('a launched coordinator', config => { config.browsers.coordinator.connect = { kind: 'launch', channel: 'chrome', headless: true, remoteDebuggingPort: 29690 }; }, /must be cdp/);
rejects('an acquirer on the sharer machine', config => { config.browsers.storageAcquirer.machine = 'mac-host'; }, /another computer/);
rejects('a browser loss target', config => { config.contributorControl.lossTarget = 'mac-host'; }, /native stage machine/);
rejects('a missing native artifact', config => { delete config.freeze.nativeArtifacts['amd-host']; }, /missing amd-host/);
rejects('a non-v3 plan', config => { config.freeze.planSchema = 'doppler.layer-partition-contract/v2'; }, /v3/);
rejects('a relative report directory', config => { config.reportDirectory = 'reports'; }, /absolute path/);
rejects('a pattern carrying a host', config => { config.modelFiles.pathPatterns = ['https://models.invalid/shard']; }, /path-only/);
rejects('more tabs than allowed', config => { config.concurrency.tabs = 9; }, /2\.\.8/);
rejects('a fractional allowance', config => { config.storage.contentionAllowanceMiB = 1.5; }, /integer/);

test('room file must be a private capability', () => {
  assert.deepEqual(validateRoom({ roomId: 'reploid-swarm-journey-a', token: 'x'.repeat(32) }), []);
  assert.equal(validateRoom({ roomId: 'reploid-swarm-public', token: 'x'.repeat(32) }).length, 1);
  assert.equal(validateRoom({ roomId: 'reploid-swarm-journey-a', token: 'short' }).length, 1);
  assert.ok(!validateRoom({ roomId: 'x', token: 'secret-token-value-that-is-long-enough' }).join('').includes('secret'));
});
test('private address guard ignores package specs and redacts addresses', () => {
  for (const value of ['doppler-gpu@0.6.27', '@roamhq/wrtc', 'peer:' + 'a'.repeat(24), 'mac-host']) assert.equal(privateAddressReason(value), null, value);
  assert.equal(privateAddressReason(tailnetHost), 'tailnet domain');
  assert.equal(privateAddressReason(`ssh ${login}`), 'login address');
  const redacted = redactPrivateAddresses(`${login} via ${tailnetHost} with doppler-gpu@0.6.27`);
  assert.equal(privateAddressReason(redacted), null);
  assert.match(redacted, /doppler-gpu@0\.6\.27/);
});
test('ordered selection id matches the catalog projection', () => {
  assert.equal(orderedSelectionId(freeze), `${freeze.modelId}/partition/${freeze.planId}`);
});
test('request classifier keeps the precedent weight paths and adds configured model files', () => {
  const patterns = compilePatterns(['/manifest\\.json$', '-pieces\\.json$']);
  assert.deepEqual(classifyRequest('http://127.0.0.1:8000/m/shard_00000.bin?x=1', patterns), { weight: true, modelFile: true, pathname: '/m/shard_00000.bin' });
  assert.equal(classifyRequest(`http://127.0.0.1:8000/piece-${'a'.repeat(64)}.bin`, []).weight, true);
  assert.equal(classifyRequest('http://127.0.0.1:8000/m/model.safetensors', []).weight, false);
  assert.equal(classifyRequest('http://127.0.0.1:8000/m/shard_1.safetensors', []).weight, true);
  assert.deepEqual(classifyRequest('http://127.0.0.1:8000/m/qwen-0-8b-pieces.json', patterns), { weight: false, modelFile: true, pathname: '/m/qwen-0-8b-pieces.json' });
  assert.equal(classifyRequest('http://127.0.0.1:8000/config/chat-models.json', patterns).modelFile, false);
  assert.equal(rangeBytes('bytes=0-4194303'), 4194304);
  assert.equal(rangeBytes(null), null);
});
