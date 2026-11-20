/** Built-in search keeps per-answer confirmation. A configured personal MCP server instead uses the
 * stored on/off permission explained beside its switch. */
export function renderWebSearchSettings() {
  return `<section class="pool-stack pool-gap-sm" data-web-search-settings aria-labelledby="web-search-title">
    <div class="pool-row pool-row-between">
      <h3 class="pool-subheading" id="web-search-title">Web search</h3>
      <button class="pool-switch" type="button" role="switch" aria-checked="false" aria-labelledby="web-search-title" data-web-search-toggle><span></span></button>
    </div>
    <details class="pool-disclosure" data-search-disclosure-details><summary>Who receives the search?</summary>
    <p class="pool-small pool-muted" data-web-search-disclosure></p></details>
    <details class="pool-disclosure" data-web-search-config><summary>Developer settings · MCP search server</summary><div class="pool-stack pool-gap-sm">
    <label class="pool-stack pool-gap-xs pool-small">MCP server URL
      <input class="pool-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://" data-web-search-url></label>
    <label class="pool-stack pool-gap-xs pool-small">Access token (optional, this tab only)
      <input class="pool-input" type="password" autocomplete="off" data-web-search-token></label>
    <label class="pool-stack pool-gap-xs pool-small">Search tool (optional)
      <input class="pool-input" type="text" autocomplete="off" spellcheck="false" placeholder="Found automatically" data-web-search-tool></label>
    <div class="pool-row">
      <button class="pool-button" type="button" data-web-search-save>Save</button>
      <button class="pool-button btn-ghost" type="button" data-web-search-check>Check server</button>
    </div>
    </div></details>
    <p class="pool-small pool-muted" role="status" data-web-search-status></p>
  </section>`;
}

const contributors = Object.freeze({
  'contributor-bing': 'Bing',
  'contributor-google-browser': 'Google'
});

export function webSearchRecipient({ personalRecipient, route, provider }) {
  if (personalRecipient) return personalRecipient;
  if (route === 'device-search') return 'your configured search server';
  if (route === 'contributor-search' && Object.hasOwn(contributors, provider)) return `the search contributor and ${contributors[provider]}`;
  if (route === 'search' && provider === 'brave') return 'Brave Search';
  return null;
}

export const webSearchDisclosure = (state, search) => {
  if (!state.url) {
    if (!search?.available()) return 'Built-in search is unavailable.';
    const provider = search.state().provider;
    if (Object.hasOwn(contributors, provider)) {
      const browser = provider === 'contributor-google-browser' ? ' in a dedicated browser' : '';
      return `A contributor searches ${contributors[provider]}${browser} and fetches public pages. Each answer names the contributor before sending your query.`;
    }
    return provider === 'brave' ? 'Use built-in web search. Each answer asks before sending your query to Brave.'
      : 'Built-in search recipient is not identified.';
  }
  return state.enabled
    ? `On. The text of each question you send goes to ${state.recipient} first. Its search results are added to the question as numbered sources. Turn off to stop.`
    : `Off. When on, the text of each question you send goes to ${state.recipient} first. Its search results are added to the question as numbered sources.`;
};

export function bindWebSearchSettings(root, webSearch, { search = null } = {}) {
  const section = root.querySelector('[data-web-search-settings]');
  if (!section || !webSearch) return () => {};
  const find = selector => section.querySelector(selector);
  const toggle = find('[data-web-search-toggle]'), url = find('[data-web-search-url]'), token = find('[data-web-search-token]');
  const tool = find('[data-web-search-tool]'), status = find('[data-web-search-status]');
  const controller = new AbortController(), options = { signal: controller.signal };
  const report = message => { status.textContent = message; };
  const render = state => {
    toggle.setAttribute('aria-checked', String(state.enabled));
    toggle.disabled = !state.url && !search?.available();
    toggle.setAttribute('aria-describedby', 'web-search-help');
    if (document.activeElement !== url) url.value = state.url;
    if (document.activeElement !== tool) tool.value = state.tool;
    token.placeholder = state.hasToken ? 'Set for this tab' : '';
    const help = find('[data-web-search-disclosure]'); help.id = 'web-search-help';
    help.textContent = webSearchDisclosure(state, search);
    const details = find('[data-search-disclosure-details]');
    if (details.dataset.enabled !== String(state.enabled)) {
      details.open = state.enabled; details.dataset.enabled = String(state.enabled);
    }
    report(state.status.message || (state.enabled && !state.url ? search?.state().message || '' : ''));
  };
  const unsubscribe = webSearch.subscribe(render);
  const unsubscribeSearch = search?.subscribe(() => render(webSearch.state())) || (() => {});
  const attempt = action => { try { action(); } catch (error) { report(error.message); } };
  toggle.addEventListener('click', () => attempt(() => webSearch.setEnabled(toggle.getAttribute('aria-checked') !== 'true', { serverAvailable: search?.available() })), options);
  find('[data-web-search-save]').addEventListener('click', () => attempt(() => {
    webSearch.configure({ url: url.value, tool: tool.value, ...(token.value ? { token: token.value } : {}) });
    token.value = '';
    if (url.value.trim()) void webSearch.check();
  }), options);
  find('[data-web-search-check]').addEventListener('click', () => { void webSearch.check(); }, options);
  return () => { controller.abort(); unsubscribe(); unsubscribeSearch(); };
}
