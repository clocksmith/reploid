import { describe, it, expect } from 'vitest';
import { contributorBlock, describeAnswerChoice, locationForModel, modelForLocation } from '../../apps/poolday/ui/pool-home/conversation-model-picker.js';
import { createExecutionPolicy } from '../../shared/vendor/reploid/chat/execution-policy.js';

// The owner's "Answer on" report: a stored model, a shared one, a downloadable one and an unavailable one.
const model = (id, extra = {}) => ({ id, name: id, identity: 'sha256:' + id, availability: 'unavailable', networkAvailability: 'unavailable', providerIds: [], ...extra });
const stored = model('stored', { localCached: true, availability: 'cached' });
const shared = model('shared', { availability: 'ready', networkAvailability: 'ready', providerIds: ['peer'], reachableProviderIds: ['peer'] });
const busy = model('busy', { availability: 'busy', networkAvailability: 'busy', providerIds: ['peer'] });
const download = model('download', { source: { baseUrl: 'https://models.example/download/' } });
const missing = model('missing');
const pooled = model('pooled', { availability: 'ready', fleet: { requester: { participantId: 'peer:you' } } });
const models = [stored, shared, busy, download, missing];
const local = createExecutionPolicy();
const open = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });

describe('Answer on selection', () => {
  it('blocks contributors only under an Only your devices preset or an invite, never for an unchosen draft', () => {
    expect(contributorBlock({ privacy: local })).toBeNull();
    expect(contributorBlock({ privacy: local, preset: 'own-devices' })).toBe('own-devices');
    expect(contributorBlock({ privacy: open, preset: 'standard' })).toBeNull();
    expect(contributorBlock({ activeThread: true, privacy: local })).toBe('own-devices');
    expect(contributorBlock({ activeThread: true, privacy: open })).toBeNull();
    expect(contributorBlock({ guest: true, privacy: open })).toBe('guest');
  });

  it('moves the computer to where a tapped model runs, unless the preset forbids contributors', () => {
    expect(locationForModel(shared, 'local')).toBe('network');
    expect(locationForModel(busy, 'local')).toBe('network');
    expect(locationForModel(shared, 'local', { block: 'own-devices' })).toBe('local');
    expect(locationForModel(stored, 'network')).toBe('local');
    expect(locationForModel(stored, 'network', { block: 'own-devices' })).toBe('local');
    // A model that runs where the sheet already is, or nowhere, leaves the computer alone.
    expect(locationForModel(stored, 'local')).toBe('local');
    expect(locationForModel(download, 'network')).toBe('network');
    expect(locationForModel(missing, 'local')).toBe('local');
    expect(locationForModel(shared, 'network', { choice: 'desktop' })).toBe('network');
  });

  it('moves to the private pool for a private-pool model, which never runs on this device, unless the preset forbids it', () => {
    expect(locationForModel(pooled, 'local')).toBe('network');
    expect(locationForModel(pooled, 'network')).toBe('network');
    expect(locationForModel(pooled, 'local', { block: 'own-devices' })).toBe('local');
    expect(modelForLocation([stored, pooled], pooled, 'local')).toBe(stored);
    const state = { discoveryPhase: 'observed' };
    expect(describeAnswerChoice(pooled, 'network', { state }).label).toBe('Answer with your private computers');
    const blocked = describeAnswerChoice(pooled, 'local', { state, block: 'own-devices' });
    expect(blocked).toMatchObject({ action: 'use-contributors', label: 'Use private computers' });
    expect(blocked.issue).toMatch(/your private pool can’t answer/);
  });

  it('keeps only a model that runs on a tapped computer', () => {
    expect(modelForLocation(models, shared, 'local')).toBe(stored);
    expect(modelForLocation(models, stored, 'network')).toBe(shared);
    expect(modelForLocation(models, shared, 'network')).toBe(shared);
    expect(modelForLocation([shared, download], shared, 'local', { canDownload: true })).toBe(download);
    expect(modelForLocation([shared, download], download, 'local', { canDownload: true })).toBe(download);
    expect(modelForLocation([stored, missing], stored, 'network')).toBe(stored);
  });

  it('never leaves a dead button: every stuck choice names its reason and the action that fixes it', () => {
    const state = { discoveryPhase: 'observed' };
    const ready = describeAnswerChoice(stored, 'local', { state });
    expect(ready).toEqual({ issue: null, action: 'commit', label: 'Answer on this device' });
    expect(describeAnswerChoice(shared, 'network', { state }).label).toBe('Answer with contributors');
    expect(describeAnswerChoice(shared, 'network', { state, sending: true }).label).toBe('Send to contributors');

    // The owner's state: this device pressed with a public-network model.
    const contradiction = describeAnswerChoice(shared, 'local', { state });
    expect(contradiction).toMatchObject({ action: 'use-contributors', label: 'Use contributors' });
    expect(contradiction.issue).toMatch(/runs on contributors’ computers.*reads your messages/);
    // Under Only your devices the same choice explains the preset and offers the change explicitly.
    const preset = describeAnswerChoice(shared, 'local', { state, block: 'own-devices' });
    expect(preset).toMatchObject({ action: 'use-contributors', label: 'Use contributors' });
    expect(preset.issue).toMatch(/^Only your devices can read this chat/);
    expect(describeAnswerChoice(shared, 'network', { state, block: 'own-devices' }).action).toBe('use-contributors');

    expect(describeAnswerChoice(download, 'local', { state, canDownload: true })).toMatchObject({ action: 'download', label: 'Download' });
    expect(describeAnswerChoice(download, 'network', { state, canDownload: true })).toMatchObject({ action: 'download', label: 'Download' });
    expect(describeAnswerChoice(stored, 'network', { state })).toMatchObject({ action: 'use-device', label: 'Use this device' });
    expect(describeAnswerChoice(missing, 'local', { state }).issue).toMatch(/Choose a model marked Ready/);
    expect(describeAnswerChoice(missing, 'network', { state: { discoveryPhase: 'searching' } }).issue).toMatch(/^Finding computers/);
    expect(describeAnswerChoice(shared, 'network', { state, block: 'guest', locked: { label: 'Studio' } }).action).toBe('commit');
    expect(describeAnswerChoice(missing, 'network', { state, block: 'guest', locked: { label: 'Studio' } }).issue).toBe('Only Studio may read your messages. Choose a model it runs.');
    // Only a choice with no fix on this sheet disables the button, and it still says why.
    for (const [item, side] of [[missing, 'local'], [missing, 'network'], [null, 'local']]) {
      const outcome = describeAnswerChoice(item, side, { state });
      expect(outcome.action).toBeNull();
      expect(outcome.issue).toBeTruthy();
    }
  });

  it('reports a download in progress or a failed one beside the choice', () => {
    const downloading = { acquisition: { modelId: 'download', phase: 'downloading', progress: { message: 'Downloading 40%' } } };
    expect(describeAnswerChoice(download, 'local', { state: downloading, canDownload: true })).toMatchObject({ issue: 'Downloading 40%', action: null });
    const failed = { acquisition: { modelId: 'download', phase: 'failed', error: 'Storage is full.' } };
    expect(describeAnswerChoice(download, 'local', { state: failed, canDownload: true })).toMatchObject({ issue: 'Storage is full.', action: 'download' });
  });
});
