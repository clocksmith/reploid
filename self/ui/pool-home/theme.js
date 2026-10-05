const THEME_STORAGE_KEY = 'reploid.appearance.v1';
const THEMES = new Set(['system', 'dark', 'light']);
const systemMedia = globalThis.matchMedia?.bind(globalThis);
const normalizeTheme = value => THEMES.has(value) ? value : 'system';

function readChoice(storage) {
  try { return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY)); }
  catch { return 'system'; }
}

function resolveTheme(choice, media) {
  if (choice !== 'system') return choice;
  return typeof media === 'function' && !media('(prefers-color-scheme: light)').matches ? 'dark' : 'light';
}

export function getPreferredTheme(storage = globalThis.localStorage, media = systemMedia) {
  return resolveTheme(readChoice(storage), media);
}

export function renderThemeSelector() {
  return `<select class="pool-theme-selector pool-button" aria-label="Appearance" data-pool-theme-choice>
    <option value="system">System</option>
    <option value="dark">Dark</option>
    <option value="light">Light</option>
  </select>`;
}

export function renderSettings(icon) {
  return `<details class="pool-settings" data-pool-settings>
    <summary class="pool-button" aria-label="Settings" title="Settings">${icon}</summary>
    <section class="pool-settings-panel pool-surface" aria-label="Settings">
      <h2>Settings</h2>
      <label>Appearance${renderThemeSelector()}</label>
    </section>
  </details>`;
}

export function applyTheme(root, theme, media = systemMedia) {
  const choice = normalizeTheme(theme);
  const selected = resolveTheme(choice, media);
  const surface = root?.querySelector?.('.pool-home');
  if (surface) surface.dataset.poolTheme = selected;
  if (globalThis.document?.documentElement) {
    globalThis.document.documentElement.dataset.reploidTheme = selected;
    globalThis.document.documentElement.style.colorScheme = selected;
  }
  root?.querySelectorAll?.('[data-pool-theme-choice]').forEach(select => { select.value = choice; });
  return selected;
}

export function bindThemeSelector(root, { storage = globalThis.localStorage, media = systemMedia } = {}) {
  let choice = readChoice(storage);
  const system = typeof media === 'function' ? media('(prefers-color-scheme: light)') : null;
  const sync = () => applyTheme(root, choice, system ? () => system : undefined);
  const onSystemChange = () => { if (choice === 'system') sync(); };
  const onChange = event => {
    const select = event.target.closest?.('[data-pool-theme-choice]');
    if (!select || !root.contains(select)) return;
    choice = normalizeTheme(select.value);
    sync();
    try { storage?.setItem(THEME_STORAGE_KEY, choice); }
    catch { /* Appearance persistence is optional. */ }
  };
  const closeSettings = event => {
    root.querySelectorAll('[data-pool-settings][open]').forEach(panel => {
      if (event.type === 'keydown') {
        if (event.key !== 'Escape') return;
        panel.open = false;
        panel.querySelector('summary').focus();
      } else if (!panel.contains(event.target)) panel.open = false;
    });
  };
  sync();
  root.ownerDocument?.addEventListener('pointerdown', closeSettings);
  root.addEventListener('keydown', closeSettings);
  system?.addEventListener?.('change', onSystemChange);
  root.addEventListener('change', onChange);
  return {
    sync,
    dispose() {
      root.removeEventListener('change', onChange);
      root.removeEventListener('keydown', closeSettings);
      root.ownerDocument?.removeEventListener('pointerdown', closeSettings);
      system?.removeEventListener?.('change', onSystemChange);
    }
  };
}

export { THEME_STORAGE_KEY };
