import { describe, expect, it } from 'vitest';
import {
  CONFIDENTIAL_TARGET, fileModeChoices, startingLocalModel, privacyPresetChoices, routePreferenceChoices,
  sharingOptionChoices, webSearchAvailability
} from '../../apps/poolday/ui/pool-home/choice-availability.js';

const byValue = (options, value) => options.find(option => option.value === value);

describe('Poolday choices are derived from what can work now', () => {
  it('never offers confidential execution as working, and names who reads content for the others', () => {
    const presets = privacyPresetChoices({ desktop: 'Studio' });
    expect(byValue(presets, 'no-device')).toMatchObject({ disabled: true, status: CONFIDENTIAL_TARGET });
    expect(CONFIDENTIAL_TARGET).toMatch(/^Not available yet\. Planned:/);
    expect(byValue(presets, 'own-devices')).toMatchObject({ disabled: false, status: expect.stringContaining('This device and Studio read') });
    expect(byValue(privacyPresetChoices(), 'own-devices').status).toMatch(/nothing leaves it\. Pair a desktop/);
    expect(byValue(presets, 'standard').status).toMatch(/computer that answers reads your messages/);
    // A conversation whose requirements the presets cannot express is read-only: every preset says so.
    const locked = privacyPresetChoices({ editable: false });
    expect(locked.every(option => option.disabled)).toBe(true);
    expect(byValue(locked, 'standard').status).toMatch(/fixed/);
    expect(byValue(locked, 'no-device').status).toBe(CONFIDENTIAL_TARGET);
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
