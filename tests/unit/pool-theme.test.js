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

  it('applies and persists the bottom-center selector choice', () => {
    const root = document.createElement('div');
    root.innerHTML = `<main class="pool-home">${renderThemeSelector()}</main>`;
    document.body.append(root);
    const writes = [];
    const binding = bindThemeSelector(root, {
      storage: { getItem: () => 'dark', setItem: (...args) => writes.push(args) },
      media: () => ({ matches: false })
    });

    expect(root.querySelector('.pool-home').dataset.poolTheme).toBe('dark');
    root.querySelector('[data-pool-theme-choice="light"]').click();
    expect(root.querySelector('.pool-home').dataset.poolTheme).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(writes).toEqual([[THEME_STORAGE_KEY, 'light']]);
    expect(root.querySelector('[data-pool-theme-choice="light"]').getAttribute('aria-pressed')).toBe('true');

    binding.dispose();
    root.remove();
    applyTheme(document.body, 'dark');
  });
});
