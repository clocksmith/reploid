import { bindDisclosure } from '../components/disclosure.js';
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

let selectors = 0;
/** Three mutually exclusive modes: a segmented radio group. Each rendered selector is its own group. */
export function renderThemeSelector() {
  const name = `pool-theme-${++selectors}`;
  return `<div class="pool-theme-selector pool-segmented" role="radiogroup" aria-label="Appearance">
    ${['system', 'light', 'dark'].map(choice => `<label class="pool-segment"><input type="radio" name="${name}" value="${choice}" data-pool-theme-choice="${choice}">${choice[0].toUpperCase() + choice.slice(1)}</label>`).join('')}
  </div>`;
}

export function renderSettings(icon, content = '') {
  return `<details class="pool-settings" data-pool-settings>
    <summary class="pool-button" aria-label="Settings" title="Settings">${icon}<span class="pool-settings-notice" data-pool-settings-review aria-hidden="true" hidden></span></summary>
    <section class="pool-settings-panel pool-surface" aria-label="Settings">
      ${renderThemeSelector()}
      ${content}
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
  }
  root?.querySelectorAll?.('[data-pool-theme-choice]').forEach(input => { input.checked = input.dataset.poolThemeChoice === choice; });
  return selected;
}

export function bindThemeSelector(root, { storage = globalThis.localStorage, media = systemMedia } = {}) {
  let choice = readChoice(storage);
  const system = typeof media === 'function' ? media('(prefers-color-scheme: light)') : null;
  let disclosures = [];
  const sync = () => {
    disclosures.forEach(item => item.dispose());
    disclosures = [...root.querySelectorAll('[data-pool-settings]:not([data-rail-settings])')].map(panel => bindDisclosure({
      root: panel, trigger: panel.querySelector('summary'), panel: panel.querySelector('section'), native: true
    }));
    return applyTheme(root, choice, system ? () => system : undefined);
  };
  const onSystemChange = () => { if (choice === 'system') sync(); };
  const onChange = event => {
    const input = event.target.closest?.('[data-pool-theme-choice]');
    if (!input || !root.contains(input) || !input.checked) return;
    const next = normalizeTheme(input.dataset.poolThemeChoice);
    if (next === choice && event.type === 'change') return;
    choice = next;
    sync();
    try { storage?.setItem(THEME_STORAGE_KEY, choice); }
    catch { /* Appearance persistence is optional. */ }
  };
  // Choosing a mode in the Settings menu closes the menu and returns focus to its button.
  const onClick = event => {
    const input = event.target.closest?.('[data-pool-theme-choice]');
    const panel = input && root.contains(input) ? input.closest('[data-pool-settings]') : null;
    if (panel) { panel.open = false; panel.querySelector('summary').focus(); }
  };
  sync();
  system?.addEventListener?.('change', onSystemChange);
  // A radio reports its choice by click in every environment and by change in browsers; both apply it once.
  root.addEventListener('change', onChange);
  root.addEventListener('click', onChange);
  root.addEventListener('click', onClick);
  return {
    sync,
    dispose() {
      root.removeEventListener('change', onChange);
      root.removeEventListener('click', onChange);
      root.removeEventListener('click', onClick);
      disclosures.forEach(item => item.dispose());
      system?.removeEventListener?.('change', onSystemChange);
    }
  };
}

export { THEME_STORAGE_KEY };
