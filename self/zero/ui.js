/** Conversation first; technical source and restoration detail remain inspectable. */
export function mountZero(mount, { agent, config, source, restored, exportSource }) {
  const document = mount.ownerDocument;
  const element = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  let style = document.getElementById('zero-capsule-style');
  if (!style) {
    style = element('link', undefined, { id: 'zero-capsule-style', rel: 'stylesheet', href: '/zero/style.css' });
    document.head.append(style);
  }
  const root = element('section', undefined, { class: 'zero-capsule' });
  const header = element('header'), status = element('span', 'idle', { role: 'status', class: 'zero-state' });
  header.append(element('h1', 'Zero'), status);
  const messages = element('div', undefined, { class: 'zero-messages', role: 'log', 'aria-live': 'polite' });
  const error = element('p', '', { role: 'alert', class: 'zero-error' });
  const form = element('form'), label = element('label', 'What should Zero build?', { for: 'zero-prompt' });
  const prompt = element('textarea', undefined, { id: 'zero-prompt', rows: '3', required: '', placeholder: 'Give Zero a goal' });
  const send = element('button', 'Awaken', { type: 'submit' });
  const stop = element('button', 'Stop', { type: 'button' });
  stop.disabled = true;
  const controls = element('div', undefined, { class: 'zero-controls' });
  controls.append(send, stop);
  form.append(label, prompt, controls);
  const inspect = element('details'), summary = element('summary', 'Inspect');
  const exportButton = element('button', 'Export self-source', { type: 'button' });
  const failures = restored.rejected.map(item => `${item.path}: ${item.error}`).join('\n');
  const provider = config.provider === 'external' ? 'Connected agent' : 'Managed Gemini';
  inspect.append(summary, element('p', `${provider} · ${source.files.length} source files · ${config.maxIterations} turns per run`),
    element('p', config.provider === 'external' ? 'Requires a local connected-agent host.' : 'Uses the existing managed endpoint with Firebase Auth and App Check.'),
    element('p', 'The conversation is saved in full; model context uses bounded recent exchanges.'),
    element('p', 'No API key is saved. Verification is static preflight plus fixture replay, not arbitrary-code isolation.'), exportButton);
  if (failures) inspect.append(element('pre', failures));
  root.append(header, messages, error, form, inspect);
  mount.replaceChildren(root);
  let dead = false, busy = false;
  const fail = reason => { if (!dead) error.textContent = reason?.message || String(reason); };
  form.onsubmit = async event => {
    event.preventDefault();
    if (dead || busy || !prompt.value.trim()) return;
    const goal = prompt.value;
    busy = true;
    try { const state = await agent.run(goal); if (state.status === 'completed' && prompt.value === goal) prompt.value = ''; }
    catch (reason) { fail(reason); }
    finally { busy = false; }
  };
  stop.onclick = () => agent.stop().catch(fail);
  exportButton.onclick = async () => {
    if (exportButton.disabled || dead) return;
    exportButton.disabled = true;
    try {
      const image = await exportSource();
      if (dead) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(image, null, 2)], { type: 'application/json' }));
      const link = element('a', undefined, { href: url, download: 'zero-source.json' });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) { fail(reason); }
    finally { exportButton.disabled = false; }
  };
  let lastMessages = '';
  return {
    render(state) {
      if (dead) return;
      status.textContent = state.status;
      status.dataset.state = state.status;
      error.textContent = state.error || (failures ? 'Some saved tools could not be restored. See Inspect.' : '');
      const active = ['running', 'thinking', 'stopping'].includes(state.status);
      send.disabled = active || state.status === 'disposed';
      stop.disabled = !active || state.status === 'stopping';
      send.textContent = state.messages.length ? 'Send' : 'Awaken';
      const serialized = JSON.stringify(state.messages);
      if (serialized === lastMessages) return;
      lastMessages = serialized;
      messages.replaceChildren(...state.messages.map(message => {
        if (message.role === 'tool') {
          const detail = element('details');
          detail.append(element('summary', message.name), element('pre', message.content));
          return detail;
        }
        const article = element('article', undefined, { class: `zero-message ${message.role}` });
        article.append(element('strong', message.role === 'user' ? 'You' : 'Zero'), element('p', message.content));
        return article;
      }));
    },
    dispose() { dead = true; form.onsubmit = stop.onclick = exportButton.onclick = null; root.remove(); }
  };
}
