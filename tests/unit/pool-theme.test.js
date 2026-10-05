import { describe, expect, it } from 'vitest';

import {
  applyTheme,
  bindThemeSelector,
  getPreferredTheme,
  renderThemeSelector,
  THEME_STORAGE_KEY
} from '../../self/ui/pool-home/theme.js';

describe('Reploid appearance selector', () => {
  it('uses a stored choice before the system preference', () => {
    const storage = { getItem: () => 'dark' };
    expect(getPreferredTheme(storage, () => ({ matches: true }))).toBe('dark');
    expect(getPreferredTheme({ getItem: () => null }, () => ({ matches: true }))).toBe('light');
  });

  it('applies and persists an explicit appearance choice', () => {
    const root = document.createElement('div');
    root.innerHTML = `<main class="pool-home">${renderThemeSelector()}</main>`;
    document.body.append(root);
    const writes = [];
    const binding = bindThemeSelector(root, {
      storage: { getItem: () => 'dark', setItem: (...args) => writes.push(args) },
      media: () => ({ matches: false })
    });

    expect(root.querySelector('.pool-home').dataset.poolTheme).toBe('dark');
    const button = root.querySelector('[data-pool-theme-choice=light]');
    button.click();
    expect(root.querySelector('.pool-home').dataset.poolTheme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(writes).toEqual([[THEME_STORAGE_KEY, 'light']]);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    binding.dispose();
    root.remove();
    applyTheme(document.body, 'dark');
  });
});

it('follows system changes until overridden and resumes following when System is selected', () => {
  const root = document.createElement('div');
  root.innerHTML = `<main class="pool-home">${renderThemeSelector()}</main>`;
  const media = new EventTarget();
  media.matches = true;
  const binding = bindThemeSelector(root, { storage: { getItem: () => null, setItem() {} }, media: () => media });
  const system = root.querySelector('[data-pool-theme-choice=system]');
  const surface = root.querySelector('.pool-home');
  expect(system.getAttribute('aria-pressed')).toBe('true');
  expect(surface.dataset.poolTheme).toBe('light');
  media.matches = false; media.dispatchEvent(new Event('change'));
  expect(surface.dataset.poolTheme).toBe('dark');
  root.querySelector('[data-pool-theme-choice=light]').click();
  media.dispatchEvent(new Event('change'));
  expect(surface.dataset.poolTheme).toBe('light');
  system.click();
  expect(surface.dataset.poolTheme).toBe('dark');
  binding.dispose();
  media.matches = true; media.dispatchEvent(new Event('change'));
  expect(surface.dataset.poolTheme).toBe('dark');
});
