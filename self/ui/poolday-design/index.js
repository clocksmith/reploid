// Poolday design system page: tokens -> primitives -> components, read live from the layer files.
// Edits apply to this page and every specimen frame; the Changes panel gives the CSS to keep them.
import { TOKEN_GROUPS, PRIMITIVE_GROUPS, loadModel, groupOf, previewKind, composition } from './model.js';
import { SPECIMEN_GROUPS, renderSpecimen } from './specimens.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const store = {
  get(key, fallback) { try { return JSON.parse(localStorage.getItem(`pds:${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`pds:${key}`, JSON.stringify(value)); } catch { /* storage is optional */ } }
};

async function loadLayerStylesheets(doc = document) {
  const manifest = await (await fetch('/styles/poolday/layers.json', { cache: 'no-store' })).json();
  const files = [manifest.tokens, manifest.primitives, ...manifest.components].map((file) => `/styles/poolday/${file}`);
  const anchor = doc.querySelector('link[data-pds-own]');
  await Promise.all(files.map((href) => new Promise((resolve) => {
    const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; link.dataset.pdsLayer = '';
    link.onload = link.onerror = resolve; doc.head.insertBefore(link, anchor);
  })));
}

const params = new URLSearchParams(location.search);
if (params.has('specimen')) {
  window.pdsReady = loadLayerStylesheets().then(() => renderSpecimen(params.get('specimen'), params.get('theme') === 'light' ? 'light' : 'dark'));
} else {
  loadLayerStylesheets().then(initPage);
}

async function initPage() {
  const root = document.querySelector('.pool-home');
  const state = {
    theme: store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
    tab: ['tokens', 'primitives', 'components'].includes(location.hash.slice(1)) ? location.hash.slice(1) : store.get('tab', 'tokens'),
    width: store.get('width', 'wide'),
    overrides: new Map(Object.entries(store.get('overrides', {}))),
    model: await loadModel(),
    rendered: new Set(),
    frames: []
  };
  root.innerHTML = renderShell();
  const $ = (selector) => root.querySelector(selector);

  // Overrides go on the page root and every .pool-home, since both declare the layers.
  let applied = new Set();
  const applyOverrides = (doc) => {
    for (const element of [doc.documentElement, ...doc.querySelectorAll('.pool-home')]) {
      for (const name of applied) if (!state.overrides.has(name)) element.style.removeProperty(name);
      for (const [name, value] of state.overrides) element.style.setProperty(name, value);
    }
  };
  const applyEverywhere = () => {
    applyOverrides(document);
    for (const frame of state.frames) if (frame.contentDocument?.querySelector('.pool-home')) applyOverrides(frame.contentDocument);
    applied = new Set(state.overrides.keys());
    store.set('overrides', Object.fromEntries(state.overrides));
    renderChanges(); refreshResolved();
  };

  const setTheme = (theme) => {
    state.theme = theme; store.set('theme', theme);
    document.documentElement.dataset.reploidTheme = theme; root.dataset.poolTheme = theme;
    root.querySelectorAll('[data-pds-theme]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pdsTheme === theme)));
    for (const frame of state.frames) {
      const doc = frame.contentDocument; if (!doc?.querySelector('.pool-home')) continue;
      doc.documentElement.dataset.reploidTheme = theme; doc.querySelector('.pool-home').dataset.poolTheme = theme;
    }
    refreshResolved();
  };
  const setTab = (tab) => {
    state.tab = tab; store.set('tab', tab); history.replaceState(null, '', `#${tab}`);
    root.querySelectorAll('[data-pds-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pdsTab === tab)));
    root.querySelectorAll('[data-pds-panel]').forEach((panel) => { panel.hidden = panel.dataset.pdsPanel !== tab; });
    $('[data-pds-width-group]').hidden = tab !== 'components';
    if (!state.rendered.has(tab)) { state.rendered.add(tab); renderPanel(tab); }
    applyFilter();
  };
  const setWidth = (width) => {
    state.width = width; store.set('width', width);
    $('[data-pds-panel="components"]').dataset.width = width;
    root.querySelectorAll('[data-pds-width]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.pdsWidth === width)));
  };

  function renderShell() {
    return `<header class="pds-header">
      <div class="pds-title">
        <h1 class="type-h1">Poolday design system</h1>
        <p class="pds-muted">Tokens hold raw values. Primitives compose tokens. Components compose primitives.</p>
      </div>
      <div class="pds-strip">
        <div class="pool-segmented" role="group" aria-label="Theme">
          ${['dark', 'light'].map((theme) => `<button class="pool-segment" type="button" data-pds-theme="${theme}">${theme === 'dark' ? 'Dark' : 'Light'}</button>`).join('')}
        </div>
        <button class="pool-button" type="button" data-pds-changes-toggle aria-expanded="false">Changes <span data-pds-change-count>0</span></button>
        <a class="pool-button pds-link-button" href="/">Open app</a>
      </div>
    </header>
    <section class="pds-layers" aria-label="Layers">
      ${[['tokens', 'Tokens', 'Raw values: colors, sizes, type, motion. They reference only other tokens.'],
        ['primitives', 'Primitives', 'Named compositions of tokens, mapped per theme. No literal values.'],
        ['components', 'Components', 'Rules that compose primitives. Only structural literals remain.']]
        .map(([id, title, text]) => `<button class="pool-surface pds-layer" type="button" data-pds-tab="${id}">
          <span class="pds-count" data-pds-count="${id}"></span><span class="type-h2">${title}</span><span class="pds-muted">${text}</span></button>`).join('<span class="pds-arrow" aria-hidden="true">→</span>')}
    </section>
    <p class="pds-muted pds-note"><code>npm run verify:pool:css</code> enforces the layering. Edits here apply live and persist in this browser until you reset them. <span data-pds-status></span></p>
    <div class="pds-toolbar">
      <input class="pool-input pds-search" type="search" placeholder="Filter by name or value" aria-label="Filter" data-pds-search>
      <div class="pool-segmented" role="group" aria-label="Specimen width" data-pds-width-group>
        <button class="pool-segment" type="button" data-pds-width="wide">Wide</button>
        <button class="pool-segment" type="button" data-pds-width="narrow">Narrow</button>
      </div>
    </div>
    <aside class="pool-surface pds-changes" data-pds-changes hidden aria-label="Changes">
      <h2 class="type-h2">Changes</h2>
      <p class="pds-muted">Each line replaces the declaration of that name in the named file.</p>
      <pre data-pds-changes-text></pre>
      <div class="pds-strip">
        <button class="pool-button btn-primary" type="button" data-pds-copy>Copy</button>
        <button class="pool-button" type="button" data-pds-reset>Reset all</button>
      </div>
    </aside>
    ${['tokens', 'primitives', 'components'].map((id) => `<section class="pds-panel" data-pds-panel="${id}" hidden></section>`).join('')}`;
  }

  function counts() {
    const { tokens, primitives, rules, manifest } = state.model;
    $('[data-pds-count="tokens"]').textContent = tokens.size;
    $('[data-pds-count="primitives"]').textContent = primitives.size;
    $('[data-pds-count="components"]').textContent = `${rules.length} rules`;
    $('[data-pds-count="components"]').title = manifest.components.join(', ');
  }

  // Token and primitive tables.
  const variableRow = (entry, kind) => {
    const source = entry.values.base ?? entry.values.light ?? entry.values.media;
    const value = state.overrides.get(entry.name) ?? source;
    const users = [...entry.usedBy];
    const usage = kind === 'token'
      ? `<button class="pds-link" type="button" data-pds-uses="${entry.name}">${users.length} use${users.length === 1 ? '' : 's'}</button>`
      : `<button class="pds-link" type="button" data-pds-rules="${entry.name}">${users.length} rule${users.length === 1 ? '' : 's'}</button>`;
    const definition = kind === 'primitive' ? Object.entries(entry.values).map(([block, text]) => `<span class="pds-def"><span class="pds-muted">${block === 'base' ? 'dark' : block}</span> ${
      escape(text).replace(/var\((--pool-[\w-]+)\)/g, '<button class="pds-chip" type="button" data-pds-token="$1">$1</button>')}</span>`).join('') : '';
    const picker = /^#[0-9a-f]{6}$/i.test(value) ? `<input class="pds-picker" type="color" value="${value}" aria-label="${entry.name} color" data-pds-picker="${entry.name}">` : '';
    return `<div class="pds-row" data-pds-var="${entry.name}" data-pds-text="${escape(`${entry.name} ${source}`.toLowerCase())}" data-pds-refs="${[...entry.refs].join(' ')}">
      <span class="pds-preview" data-kind="text" style="--pds-preview: var(${entry.name})"><span>Aa</span></span>
      <span class="pds-cell">
        <code class="pds-name">${entry.name}</code>
        ${definition}
        <span class="pds-resolved pds-muted" data-pds-resolved></span>
      </span>
      <span class="pds-edit">${picker}<input class="pool-input pds-value" type="text" value="${escape(value)}" data-pds-input="${entry.name}" data-pds-source="${escape(source)}" aria-label="${entry.name} value"><button class="pds-link" type="button" data-pds-revert="${entry.name}" ${state.overrides.has(entry.name) ? '' : 'hidden'}>Revert</button></span>
      <span class="pds-usage">${usage}</span>
      <div class="pds-rule-list" data-pds-rule-list hidden></div>
    </div>`;
  };
  const variablePanel = (entries, groups, kind) => groups.concat([['other', 'Other']]).map(([id, title]) => {
    const list = [...entries.values()].filter((entry) => groupOf(entry.name, groups) === id);
    if (!list.length) return '';
    return `<details class="pds-group" open data-pds-group><summary class="pds-group-title"><span class="type-h2">${title}</span><span class="pds-muted" data-pds-group-count>${list.length}</span></summary>
      <div class="pds-rows">${list.map((entry) => variableRow(entry, kind)).join('')}</div></details>`;
  }).join('');

  function refreshResolved() {
    const style = getComputedStyle(root);
    for (const row of root.querySelectorAll('[data-pds-var]')) {
      const name = row.dataset.pdsVar;
      const resolved = style.getPropertyValue(name).trim();
      const preview = row.querySelector('.pds-preview');
      preview.dataset.kind = previewKind(name, resolved);
      const out = row.querySelector('[data-pds-resolved]');
      const source = row.querySelector('[data-pds-input]')?.dataset.pdsSource;
      out.textContent = resolved && resolved !== source ? `= ${resolved.length > 160 ? `${resolved.slice(0, 160)}…` : resolved}` : '';
      row.classList.toggle('is-edited', state.overrides.has(name));
    }
  }

  // Component specimens, each in its own frame so page layouts render at their real size.
  function componentPanel() {
    const base = `${location.pathname}?specimen=`;
    return SPECIMEN_GROUPS.map((group) => `<section class="pds-group" data-pds-group><h2 class="type-h2 pds-group-heading">${group.title}</h2>
      <div class="pds-specimens">${group.specimens.map((specimen) => `<article class="pds-specimen" data-pds-specimen="${specimen.id}" data-pds-text="${escape(`${specimen.id} ${specimen.title}`.toLowerCase())}">
        <header class="pds-specimen-head"><span class="pds-specimen-title">${escape(specimen.title)}</span><span class="pds-muted" data-pds-made>Loading</span></header>
        <iframe class="pds-frame" ${specimen.page ? 'data-page' : ''} title="${escape(specimen.title)}" loading="lazy" src="${base}${specimen.id}&theme=${state.theme}"></iframe>
        <details class="pds-made"><summary>Primitives and tokens</summary><div class="pds-chips" data-pds-made-list></div></details>
      </article>`).join('')}</div></section>`).join('');
  }
  function watchFrame(frame) {
    state.frames.push(frame);
    frame.addEventListener('load', async () => {
      await frame.contentWindow.pdsReady;
      const doc = frame.contentDocument;
      doc.documentElement.dataset.reploidTheme = state.theme; doc.querySelector('.pool-home').dataset.poolTheme = state.theme;
      applyOverrides(doc);
      describeFrame(frame);
    });
  }
  function describeFrame(frame) {
    const card = frame.closest('[data-pds-specimen]');
    const { matched, used } = composition(frame.contentDocument, state.model.rules);
    const primitives = [...used.keys()].filter((name) => state.model.primitives.has(name)).sort();
    const tokens = new Set(primitives.flatMap((name) => [...state.model.primitives.get(name).refs]));
    card.dataset.pdsUses = primitives.join(' ');
    card.querySelector('[data-pds-made]').textContent = `${matched} rules · ${primitives.length} primitives · ${tokens.size} tokens`;
    card.querySelector('[data-pds-made-list]').innerHTML = primitives
      .map((name) => `<button class="pds-chip" type="button" data-pds-primitive="${name}">${name}</button>`).join('');
  }

  function renderPanel(tab) {
    const panel = $(`[data-pds-panel="${tab}"]`);
    if (tab === 'tokens') panel.innerHTML = variablePanel(state.model.tokens, TOKEN_GROUPS, 'token');
    if (tab === 'primitives') panel.innerHTML = variablePanel(state.model.primitives, PRIMITIVE_GROUPS, 'primitive');
    if (tab === 'components') {
      panel.innerHTML = componentPanel();
      panel.querySelectorAll('iframe').forEach(watchFrame);
    }
    refreshResolved();
  }

  // Filtering: free text, or "uses:--name" for everything that references a variable.
  function applyFilter() {
    const query = $('[data-pds-search]').value.trim().toLowerCase();
    const uses = query.startsWith('uses:') ? query.slice(5).trim() : null;
    const panel = $(`[data-pds-panel="${state.tab}"]`);
    for (const item of panel.querySelectorAll('[data-pds-text]')) {
      const refs = ` ${item.dataset.pdsRefs ?? item.dataset.pdsUses ?? ''} `;
      item.hidden = uses ? !refs.includes(` ${uses} `) : Boolean(query) && !item.dataset.pdsText.includes(query);
    }
    for (const group of panel.querySelectorAll('[data-pds-group]')) {
      const visible = group.querySelectorAll('[data-pds-text]:not([hidden])').length;
      group.hidden = visible === 0;
      const count = group.querySelector('[data-pds-group-count]'); if (count) count.textContent = visible;
    }
  }
  const showUses = (tab, name) => { $('[data-pds-search]').value = `uses:${name}`; setTab(tab); applyFilter(); window.scrollTo({ top: $('.pds-toolbar').offsetTop }); };
  const showName = (tab, name) => { $('[data-pds-search]').value = name; setTab(tab); applyFilter(); window.scrollTo({ top: $('.pds-toolbar').offsetTop }); };

  function renderChanges() {
    $('[data-pds-change-count]').textContent = state.overrides.size;
    const byFile = new Map();
    for (const [name, value] of state.overrides) {
      const entry = state.model.tokens.get(name) ?? state.model.primitives.get(name);
      const file = `self/styles/poolday/${entry?.file ?? 'unknown'}`;
      const was = entry?.values.base ?? entry?.values.light ?? '';
      byFile.set(file, [...(byFile.get(file) ?? []), `  ${name}: ${value}; /* was ${was} */`]);
    }
    $('[data-pds-changes-text]').textContent = [...byFile].map(([file, lines]) => `/* ${file} */\n${lines.join('\n')}`).join('\n\n') || 'No changes.';
  }
  const setOverride = (name, value) => {
    const input = root.querySelector(`[data-pds-input="${name}"]`);
    const source = input?.dataset.pdsSource;
    if (!value.trim() || value.trim() === source) state.overrides.delete(name); else state.overrides.set(name, value.trim());
    if (input) input.value = state.overrides.get(name) ?? source;
    const revert = root.querySelector(`[data-pds-revert="${name}"]`); if (revert) revert.hidden = !state.overrides.has(name);
    applyEverywhere();
  };

  root.addEventListener('click', async (event) => {
    const target = event.target.closest('button, a'); if (!target) return;
    const data = target.dataset;
    if (data.pdsTheme) setTheme(data.pdsTheme);
    else if (data.pdsTab) setTab(data.pdsTab);
    else if (data.pdsWidth) setWidth(data.pdsWidth);
    else if (data.pdsUses) showUses('primitives', data.pdsUses);
    else if (data.pdsToken) showName(state.model.tokens.has(data.pdsToken) ? 'tokens' : 'primitives', data.pdsToken);
    else if (data.pdsPrimitive) showName('primitives', data.pdsPrimitive);
    else if (data.pdsRevert) setOverride(data.pdsRevert, '');
    else if (data.pdsRules) {
      const list = target.closest('[data-pds-var]').querySelector('[data-pds-rule-list]');
      if (list.hidden) {
        const selectors = [...state.model.primitives.get(data.pdsRules).usedBy];
        list.innerHTML = `${selectors.slice(0, 40).map((selector) => `<code>${escape(selector)}</code>`).join('')}${selectors.length > 40 ? `<span class="pds-muted">and ${selectors.length - 40} more</span>` : ''}
          <button class="pds-link" type="button" data-pds-show-components="${data.pdsRules}">Show components that use it</button>`;
      }
      list.hidden = !list.hidden;
    } else if (data.pdsShowComponents) showUses('components', data.pdsShowComponents);
    else if ('pdsChangesToggle' in data) {
      const panel = $('[data-pds-changes]'); panel.hidden = !panel.hidden; target.setAttribute('aria-expanded', String(!panel.hidden));
    } else if ('pdsCopy' in data) {
      try { await navigator.clipboard.writeText($('[data-pds-changes-text]').textContent); target.textContent = 'Copied'; }
      catch { target.textContent = 'Select the text to copy'; }
      setTimeout(() => { target.textContent = 'Copy'; }, 1600);
    } else if ('pdsReset' in data) {
      for (const name of [...state.overrides.keys()]) setOverride(name, '');
    }
  });
  root.addEventListener('change', (event) => {
    const { pdsInput, pdsPicker } = event.target.dataset;
    if (pdsInput) setOverride(pdsInput, event.target.value);
    if (pdsPicker) setOverride(pdsPicker, event.target.value);
  });
  root.addEventListener('input', (event) => {
    if (event.target.dataset.pdsPicker) setOverride(event.target.dataset.pdsPicker, event.target.value);
    if ('pdsSearch' in event.target.dataset) applyFilter();
  });

  // Live reload: when a layer file changes on disk, swap the stylesheet everywhere and re-read the model.
  const stamps = new Map();
  const layerFiles = () => [state.model.manifest.tokens, state.model.manifest.primitives, ...state.model.manifest.components].map((file) => `/styles/poolday/${file}`);
  async function poll() {
    if (document.visibilityState !== 'visible') return;
    const changed = [];
    for (const href of [...layerFiles(), '/styles/poolday-design.css']) {
      try {
        const response = await fetch(href, { method: 'HEAD', cache: 'no-store' });
        const stamp = response.headers.get('etag') ?? response.headers.get('last-modified');
        if (stamps.has(href) && stamps.get(href) !== stamp) changed.push(href);
        stamps.set(href, stamp);
      } catch { /* the server is restarting */ }
    }
    if (!changed.length) return;
    const bust = (doc) => Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].filter((link) => changed.includes(new URL(link.href).pathname))
      .map((link) => new Promise((resolve) => { const next = link.cloneNode(); next.href = `${new URL(link.href).pathname}?v=${Date.now()}`; next.onload = next.onerror = () => { link.remove(); resolve(); }; link.after(next); })));
    await Promise.all([bust(document), ...state.frames.filter((frame) => frame.contentDocument?.querySelector('.pool-home')).map((frame) => bust(frame.contentDocument))]);
    state.model = await loadModel();
    counts();
    for (const tab of state.rendered) if (tab !== 'components') renderPanel(tab);
    applyEverywhere(); applyFilter();
    for (const frame of state.frames) if (frame.contentDocument?.querySelector('.pool-home')) describeFrame(frame);
    $('[data-pds-status]').textContent = `Reloaded ${changed.map((href) => href.split('/').pop()).join(', ')} at ${new Date().toLocaleTimeString()}.`;
  }
  setInterval(poll, 2000); poll();
  addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (tab !== state.tab && ['tokens', 'primitives', 'components'].includes(tab)) setTab(tab);
  });

  counts();
  setTheme(state.theme);
  setWidth(state.width);
  setTab(state.tab);
  applyEverywhere();
}
