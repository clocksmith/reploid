import { describe, expect, it } from 'vitest';
import {
  fileModeChoices, startingLocalModel, protectionChoices, routeChoices, ownDevicesChoice, routePreferenceChoices,
  sharingOptionChoices, webSearchAvailability
} from '../../apps/poolday/ui/pool-home/choice-availability.js';
import { PROTECTION_DISPLAY, ROUTE_DISPLAY, gatedCapabilities } from '../../packages/reploid/src/inference/protections.js';

const byValue = (options, value) => options.find(option => option.value === value);

describe('Poolday choices are derived from what can work now', () => {
  it('lists every protection unranked with its shared line, disabling each unavailable one with its reason', () => {
    const protections = protectionChoices();
    expect(protections.map(option => option.value)).toEqual(['plaintext', 'secret-sharing', 'homomorphic', 'attested']);
    expect(byValue(protections, 'plaintext')).toMatchObject({ title: 'Standard', checked: true, disabled: false, status: PROTECTION_DISPLAY.plaintext.line });
    for (const value of ['secret-sharing', 'homomorphic', 'attested']) {
      expect(byValue(protections, value)).toMatchObject({ title: PROTECTION_DISPLAY[value].label, disabled: true, status: expect.stringMatching(/\. Unavailable: \S/) });
    }
    // A protection a host enabled but did not resolve is "unknown": offered, with its line, never claimed available.
    const enabled = protectionChoices({ capabilities: gatedCapabilities({ enabled: ['plaintext', 'secret-sharing'] }) });
    expect(byValue(enabled, 'secret-sharing')).toMatchObject({ disabled: false, status: PROTECTION_DISPLAY['secret-sharing'].line });
    expect(byValue(enabled, 'attested').disabled).toBe(true);
  });

  it('lists the five routes, disables those this chat cannot use with reasons, and keeps only-your-devices a participants choice', () => {
    const routes = routeChoices();
    expect(routes.map(option => option.value)).toEqual(['local', 'remote', 'split', 'split-local-edges', 'auto']);
    expect(routes.map(option => option.title)).toEqual(Object.values(ROUTE_DISPLAY).map(row => row.label));
    expect(byValue(routes, 'auto')).toMatchObject({ checked: true, disabled: false });
    expect(byValue(routes, 'split')).toMatchObject({ disabled: true, status: 'Unavailable: Only a model that runs in stages uses several computers.' });
    expect(byValue(routes, 'split-local-edges')).toMatchObject({ disabled: true, status: 'Unavailable: This browser cannot bind both edge devices to you.' });
    const staged = routeChoices({ model: { partition: {} }, value: 'split' });
    expect(byValue(staged, 'split')).toMatchObject({ checked: true, disabled: false });
    expect(byValue(staged, 'local').disabled).toBe(true);
    expect(byValue(staged, 'remote').disabled).toBe(true);
    expect(byValue(routeChoices({ canRunHere: false }), 'local').status).toMatch(/network computers only/);
    // Only your devices: not a route; it needs a paired desktop and a network route.
    expect(ownDevicesChoice({ desktop: 'Studio' })).toMatchObject({ title: 'Only your devices', disabled: false, status: expect.stringContaining('This device and Studio process') });
    expect(ownDevicesChoice().status).toMatch(/Pair a desktop/);
    expect(ownDevicesChoice({ desktop: 'Studio', route: 'local', checked: true })).toMatchObject({ disabled: true, checked: false });
    // A conversation whose requirements these choices cannot express is read-only: every option says so.
    const locked = routeChoices({ editable: false });
    expect(locked.every(option => option.disabled)).toBe(true);
    expect(byValue(locked, 'auto').status).toMatch(/fixed/);
    expect(ownDevicesChoice({ desktop: 'Studio', editable: false }).disabled).toBe(true);
    expect(protectionChoices({ editable: false }).every(option => option.disabled)).toBe(true);
  });

  it('disables route preference with the reason when only one computer can answer', () => {
    const off = routePreferenceChoices({ remoteAnswersEnabled: false, canSet: true, value: 'faster' });
    expect(off.reason).toMatch(/Network answers are off/);
    expect(off.fix).toMatchObject({ action: 'show-network-answers' });
    expect(off.options.every(option => option.disabled)).toBe(true);
    expect(byValue(off.options, 'faster').checked).toBe(true);
    const on = routePreferenceChoices({ remoteAnswersEnabled: true, canSet: true });
    expect(on).toMatchObject({ reason: '', fix: null });
    expect(on.options.map(option => option.value)).toEqual(['balanced', 'faster', 'more-reliable']);
    expect(on.options.some(option => option.disabled)).toBe(false);
    // A page without a preference port has nothing to fix.
    expect(routePreferenceChoices({ remoteAnswersEnabled: true, canSet: false })).toMatchObject({ fix: null, reason: expect.stringMatching(/nothing to order/) });
  });

  it('states what each file mode downloads, and fixes the mode while files are shared', () => {
    const none = fileModeChoices();
    expect(byValue(none, 'cached-only')).toMatchObject({ checked: true, disabled: false, status: expect.stringContaining('Nothing is downloaded yet') });
    expect(byValue(fileModeChoices({ storedModels: 2 }), 'cached-only').status).toMatch(/^Shares 2 downloaded models/);
    expect(byValue(fileModeChoices({ storedModels: 1 }), 'cached-only').status).toMatch(/^Shares 1 downloaded model\./);
    const sharing = fileModeChoices({ sharing: true, value: 'full-model' });
    expect(sharing.every(option => option.disabled && option.status === 'Turn off Share model files to change this.')).toBe(true);
    expect(byValue(sharing, 'full-model').checked).toBe(true);
  });

  it('offers only the sharing a page can perform, and never checks an unavailable one', () => {
    const none = sharingOptionChoices({ compute: true, files: true });
    expect(none.every(option => option.disabled && !option.checked)).toBe(true);
    expect(byValue(none, 'compute').status).toBe('This page cannot share compute.');
    const both = sharingOptionChoices({ canShareCompute: true, canShareFiles: true, compute: true, files: false });
    expect(byValue(both, 'compute')).toMatchObject({ disabled: false, checked: true });
    expect(byValue(both, 'files')).toMatchObject({ disabled: false, checked: false });
  });

  it('turns web search on only with a known recipient, and otherwise offers adding a server', () => {
    expect(webSearchAvailability({ url: 'https://search.example' })).toEqual({ disabled: false, reason: '', fix: null });
    expect(webSearchAvailability({ builtInAvailable: true }).disabled).toBe(false);
    expect(webSearchAvailability()).toMatchObject({ disabled: true, reason: expect.stringMatching(/No search service/), fix: { action: 'open-search-server' } });
  });

  it('starts this device on a stored model, else a downloadable one, never a network-only model', () => {
    const shared = { id: 'shared', networkAvailability: 'ready' };
    const small = { id: 'small', source: { baseUrl: 'x' } }, large = { id: 'large', source: { baseUrl: 'x' } };
    const stored = { id: 'stored', localCached: true };
    const canDownloadHere = model => !!model.source;
    expect(startingLocalModel([shared, large, small, stored], { defaultModel: small, canDownloadHere })).toBe(stored);
    expect(startingLocalModel([shared, large, small], { defaultModel: small, canDownloadHere })).toBe(small);
    expect(startingLocalModel([shared, large, small], { canDownloadHere })).toBe(large);
    expect(startingLocalModel([shared], { defaultModel: shared, canDownloadHere })).toBeNull();
    expect(startingLocalModel([{ ...stored, partition: true }, { id: 'fleet', fleet: {}, localCached: true }], { canDownloadHere })).toBeNull();
  });
});
