import policy from '../../pool/document-search-policy.json' with { type: 'json' };

export const renderDocumentSearch = () => `
  <section class="pool-document-search pool-task-card" id="pool-document-search" data-document-search hidden aria-label="Document search">
    <h2 class="type-h2">Search documents</h2>
    <p class="type-caption">Files and questions stay in this tab. No peer sharing.</p>
    <p class="type-caption" role="status" aria-live="polite" id="pool-document-status" data-document-status>Choose models to start.</p>
    <details class="pool-advanced" data-document-setup open>
      <summary>Models</summary>
      <label class="pool-field"><span>Model settings (.json)</span>
        <input type="file" accept=".json" data-document-models></label>
      <label class="pool-consent-row"><input type="checkbox" data-document-trust>
        <span>I trust these publishers to supply model files.</span></label>
      <button type="button" class="btn btn-primary pool-primary-action" data-document-configure>Use models</button>
      <p class="type-caption" data-document-model-status>No models selected</p>
      <p class="type-caption"><a href="https://github.com/clocksmith/reploid/blob/main/docs/poolday/document-search.md" target="_blank" rel="noopener">Where to get model settings</a></p>
    </details>
    <form data-document-form>
      <label class="pool-field"><span>Documents (.txt, .md)</span>
        <input type="file" accept=".txt,.md" multiple data-document-files></label>
      <p class="type-caption" data-document-corpus>No documents</p>
      <label class="pool-field"><span>Question</span>
        <input type="text" required maxlength="4096" autocomplete="off" data-document-query></label>
      <label class="pool-consent-row"><input type="checkbox" data-document-rerank disabled>
        <span>Improve result order</span></label>
      <label class="pool-consent-row"><input type="checkbox" data-document-answer disabled>
        <span>Write an answer with references</span></label>
      <div class="pool-document-actions">
        <button class="btn btn-primary pool-primary-action" type="submit" data-document-submit aria-describedby="pool-document-status">Search</button>
        <button class="btn btn-ghost" type="button" data-document-cancel hidden>Cancel</button>
        <button class="btn btn-ghost" type="button" data-document-clear>Clear documents</button>
      </div>
    </form>
    <div class="pool-document-answer" data-document-answer-output hidden aria-label="Answer"></div>
    <ol class="pool-document-results" data-document-results aria-label="Relevant passages"></ol>
    <details class="pool-advanced" data-document-evidence hidden><summary>Job details</summary><pre></pre></details>
  </section>`;

function renderMatches(root, result) {
  const list = root.querySelector('[data-document-results]');
  if (!list) return;
  list.replaceChildren();
  const answer = root.querySelector('[data-document-answer-output]');
  answer.hidden = !result?.answer;
  answer.textContent = result?.answer?.text || '';
  for (const match of result?.matches || []) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${match.sources.join(', ')} · characters ${match.start + 1}–${match.end}`;
    const passage = document.createElement('p'); passage.textContent = match.text;
    item.append(title, passage); list.append(item);
  }
  const evidence = root.querySelector('[data-document-evidence]');
  evidence.hidden = !result;
  evidence.querySelector('pre').textContent = result ? JSON.stringify({ execution: result.execution,
    corpusHash: result.corpusHash, receipts: result.receipts, indexReceipt: result.indexReceipt }, null, 2) : '';
}

export function refreshDocumentSearch(root, state) {
  const surface = root.querySelector('[data-document-search]');
  if (!surface) return;
  const setup = surface.querySelector('[data-document-setup]');
  if (!state.configured) setup.open = true;
  else if (surface.dataset.configured !== 'true') setup.open = false;
  surface.dataset.configured = String(state.configured);
  surface.querySelector('[data-document-model-status]').textContent = state.configured ? 'Models selected' : 'No models selected';
  surface.querySelector('[data-document-corpus]').textContent = state.corpus
    ? state.corpus.documents.map((item) => item.sources.join(', ')).join(' · ') : 'No documents';
  const statusLabels = { Embedding: 'Preparing search', Reranking: 'Ordering results' };
  const status = !state.busy && !state.configured ? 'Choose models to start.'
    : !state.busy && !state.corpus ? 'Add documents to start.'
      : statusLabels[state.status] || state.status;
  surface.querySelector('[data-document-status]').textContent = status;
  surface.querySelector('[data-document-submit]').disabled = state.busy || !state.configured || !state.corpus;
  surface.querySelector('[data-document-cancel]').hidden = !state.busy;
  for (const selector of ['[data-document-files]', '[data-document-configure]', '[data-document-query]']) {
    surface.querySelector(selector).disabled = state.busy;
  }
  const rerank = surface.querySelector('[data-document-rerank]');
  rerank.disabled = state.busy || !state.hasReranker;
  if (!state.hasReranker) rerank.checked = false;
  const generate = surface.querySelector('[data-document-answer]');
  generate.disabled = state.busy || !state.hasGenerator;
  if (!state.hasGenerator) generate.checked = false;
  renderMatches(surface, state.result);
}

export function bindDocumentSearch(root, workflow) {
  const controller = new AbortController();
  let generation = 0;
  const listen = (selector, event, callback) => root.querySelector(selector)?.addEventListener(event, callback, { signal: controller.signal });
  const error = (cause) => {
    if (!controller.signal.aborted) root.querySelector('[data-document-status]').textContent = cause.message;
  };
  listen('[data-document-configure]', 'click', async () => {
    const attempt = ++generation;
    try {
      const file = root.querySelector('[data-document-models]').files[0];
      if (!file || file.size > 1048576) throw new Error('Choose model settings smaller than 1 MiB');
      if (!root.querySelector('[data-document-trust]').checked) throw new Error('Confirm you trust the model publishers first');
      const configuration = JSON.parse(await file.text());
      if (controller.signal.aborted || attempt !== generation) return;
      if (!root.querySelector('[data-document-trust]').checked) throw new Error('Publisher trust was withdrawn');
      workflow.configure(configuration);
    } catch (cause) { error(cause); }
  });
  listen('[data-document-models]', 'change', () => {
    generation++; root.querySelector('[data-document-trust]').checked = false;
  });
  listen('[data-document-files]', 'change', async (event) => {
    const attempt = ++generation;
    try {
      const files = [...event.target.files];
      if (!files.length) return;
      if (files.length > policy.maxDocuments || files.some((file) => file.size > policy.maxDocumentBytes)
        || files.reduce((sum, file) => sum + file.size, 0) > policy.maxCorpusBytes) throw new Error('Document size limit exceeded');
      if (files.some((file) => !/\.(txt|md)$/i.test(file.name))) throw new Error('Choose plain text or Markdown documents');
      const documents = await Promise.all(files.map(async (file) => ({ name: file.name,
        text: new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()) })));
      if (!controller.signal.aborted && attempt === generation) await workflow.setDocuments(documents);
    } catch (cause) { error(cause); }
  });
  listen('[data-document-form]', 'submit', async (event) => {
    event.preventDefault();
    try {
      await workflow.search({ query: root.querySelector('[data-document-query]').value,
        rerank: root.querySelector('[data-document-rerank]').checked,
        generateAnswer: root.querySelector('[data-document-answer]').checked });
    } catch (cause) { error(cause); }
  });
  listen('[data-document-cancel]', 'click', () => { generation++; workflow.cancel(); });
  listen('[data-document-clear]', 'click', () => {
    generation++; workflow.clear();
    root.querySelector('[data-document-files]').value = '';
    root.querySelector('[data-document-query]').value = '';
  });
  for (const button of root.querySelectorAll('[data-pool-workflow]')) {
    button.addEventListener('click', () => {
      if (workflow.getState().busy || root.querySelector('[data-pool-run-surface]')?.dataset.runState === 'running') return;
      const documents = button.dataset.poolWorkflow === 'documents';
      for (const choice of root.querySelectorAll('[data-pool-workflow]')) choice.setAttribute('aria-pressed', String(choice === button));
      root.querySelector('[data-document-search]').hidden = !documents;
      root.querySelector('#pool-home-ask-form').hidden = documents;
      root.querySelector('[data-pool-run-output]').hidden = documents || root.querySelector('[data-pool-run-surface]').dataset.runState === 'idle';
    }, { signal: controller.signal });
  }
  refreshDocumentSearch(root, workflow.getState());
  const query = root.querySelector('[data-document-query]');
  if (query && workflow.getState().result) {
    query.value = workflow.getState().result.query;
    root.querySelector('[data-document-rerank]').checked = workflow.getState().result.reranked;
    root.querySelector('[data-document-answer]').checked = Boolean(workflow.getState().result.answer);
  }
  return () => { generation++; controller.abort(); };
}

export function renderLocalDocumentHistory(root, state) {
  root.querySelector('[data-document-history]')?.remove();
  if (!state.history.length) return;
  const section = document.createElement('section');
  section.className = 'pool-document-history'; section.dataset.documentHistory = '';
  const heading = document.createElement('h2'); heading.textContent = 'Local document searches';
  const notice = document.createElement('p'); notice.textContent = 'Saved in this tab. Documents stay on this device.';
  const list = document.createElement('ol');
  for (const entry of state.history) {
    const item = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `${entry.startedAt} · ${entry.status}`;
    const record = document.createElement('pre'); record.textContent = JSON.stringify(entry, null, 2);
    details.append(summary, record); item.append(details); list.append(item);
  }
  section.append(heading, notice, list); root.querySelector('main')?.append(section);
}
