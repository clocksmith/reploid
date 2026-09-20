const THEME_STORAGE_KEY = 'reploid.appearance.v1';
const THEMES = new Set(['dark', 'light']);

const normalizeTheme = value => THEMES.has(value) ? value : null;

export function getPreferredTheme(storage = globalThis.localStorage, media = globalThis.matchMedia) {
  try {
    const stored = normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    // Appearance persistence is optional.
  }
  return typeof media === 'function' && media('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function renderThemeSelector() {
  return `<div class="pool-theme-selector" role="group" aria-label="Appearance">
    <button type="button" data-pool-theme-choice="dark" aria-pressed="false">Dark</button>
    <button type="button" data-pool-theme-choice="light" aria-pressed="false">Light</button>
  </div>`;
}

export function applyTheme(root, theme) {
  const selected = normalizeTheme(theme) || 'dark';
  const surface = root?.querySelector?.('.pool-home');
  if (surface) surface.dataset.poolTheme = selected;
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.dataset.reploidTheme = selected;
    globalThis.document.documentElement.style.colorScheme = selected;
  }
  root?.querySelectorAll?.('[data-pool-theme-choice]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.poolThemeChoice === selected));
  });
  return selected;
}

export function bindThemeSelector(root, { storage = globalThis.localStorage, media = globalThis.matchMedia } = {}) {
  let selected = applyTheme(root, getPreferredTheme(storage, media));
  const onClick = event => {
    const button = event.target.closest?.('[data-pool-theme-choice]');
    if (!button || !root.contains(button)) return;
    selected = applyTheme(root, button.dataset.poolThemeChoice);
    try {
      storage?.setItem(THEME_STORAGE_KEY, selected);
    } catch {
      // Appearance persistence is optional.
    }
  };
  root.addEventListener('click', onClick);
  return {
    sync: () => applyTheme(root, selected),
    dispose: () => root.removeEventListener('click', onClick)
  };
}

export { THEME_STORAGE_KEY };
