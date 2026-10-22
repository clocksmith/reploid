/* @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initZeroBootHome } from '../../self/ui/zero-home/index.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '<main id="home"></main>';
  window.getReploidMode = () => 'zero';
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network is not used by layout tests'))));
});

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
  delete window.getReploidMode;
  vi.unstubAllGlobals();
});

describe('X/Zero objective settings layout', () => {
  it('places X interval settings and explicit optional upgrades after the goal editor', () => {
    window.getReploidMode = () => 'x';
    initZeroBootHome(document.querySelector('#home'));
    const interval = document.querySelector('#cycle-interval-seconds');
    const settings = interval.closest('.zero-objective-settings');
    expect(settings).toBeTruthy();
    expect(document.querySelector('#zero-upgrade-level').closest('.zero-objective-settings')).toBe(settings);
    expect(document.querySelector('#zero-upgrade-level').value).toBe('spark');
    expect(document.querySelector('#zero-upgrade-level').selectedOptions[0].textContent).toBe('None: Zero core');
    expect(document.querySelector('[for="cycle-interval-seconds"]').control).toBe(interval);
    expect(settings.previousElementSibling.querySelector('#goal-input')).toBeTruthy();
  });

  it('keeps Zero interval settings available without exposing optional upgrades', () => {
    initZeroBootHome(document.querySelector('#home'));
    expect(document.querySelector('.zero-objective-settings #cycle-interval-seconds')).toBeTruthy();
    expect(document.querySelector('#zero-upgrade-level')).toBeNull();
  });

  it.each([
    ['9.54', '9.5'],
    ['-1', '0'],
    ['9999', '3600'],
    ['0', '0']
  ])('preserves interval normalization for input %s across a UI refresh', async (input, expected) => {
    initZeroBootHome(document.querySelector('#home'));
    const interval = document.querySelector('#cycle-interval-seconds');
    interval.value = input;
    interval.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="choose-proxy"]').click();
    await vi.waitFor(() => expect(document.querySelector('#cycle-interval-seconds')).not.toBe(interval));
    expect(document.querySelector('#cycle-interval-seconds').value).toBe(expected);
    expect(fetch).not.toHaveBeenCalled();
  });
});
