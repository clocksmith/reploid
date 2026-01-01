/**
 * Proto Schemas - Schema registry panel logic
 */

export const createSchemaManager = (deps) => {
  const { logger, escapeHtml } = deps;

  let _schemaRegistrySvc = null;
  let _toolSchemas = [];
  let _workerSchemas = [];
  let _schemaSearch = '';
  let _schemaLoaded = false;

  const resolveSchemaRegistry = async () => {
    if (_schemaRegistrySvc) return _schemaRegistrySvc;
    try {
      _schemaRegistrySvc = window.REPLOID?.schemaRegistry
        || (await window.REPLOID_DI?.resolve?.('SchemaRegistry'));
    } catch (e) {
      logger.warn('[Proto] SchemaRegistry unavailable', e?.message || e);
    }
    return _schemaRegistrySvc;
  };

  const renderSchemaPanel = () => {
    const toolList = document.getElementById('schema-tool-list');
    const workerList = document.getElementById('schema-worker-list');
    const toolCountEl = document.getElementById('schema-tool-count');
    const workerCountEl = document.getElementById('schema-worker-count');
    if (!toolList || !workerList) return;

    const query = _schemaSearch.trim().toLowerCase();
    const filteredTools = _toolSchemas.filter(entry => entry.name.toLowerCase().includes(query));
    const filteredWorkers = _workerSchemas.filter(entry => entry.name.toLowerCase().includes(query));

    if (toolCountEl) toolCountEl.textContent = `${filteredTools.length} tools`;
    if (workerCountEl) workerCountEl.textContent = `${filteredWorkers.length} worker types`;

    toolList.innerHTML = filteredTools.length === 0
      ? '<div class="schema-empty muted">No tool schemas match your search</div>'
      : filteredTools.map(entry => {
          const description = entry.schema?.description || 'No description';
          const payload = entry.schema?.parameters ? JSON.stringify(entry.schema.parameters, null, 2) : '{}';
          const badge = entry.builtin ? '<span class="schema-badge">core</span>' : '';
          return `
            <article class="schema-card">
              <header>
                <div>
                  <strong>${escapeHtml(entry.name)}</strong>
                  ${badge}
                </div>
                <small>${escapeHtml(description)}</small>
              </header>
              <pre>${escapeHtml(payload)}</pre>
            </article>
          `;
        }).join('');

    workerList.innerHTML = filteredWorkers.length === 0
      ? '<div class="schema-empty muted">No worker definitions match your search</div>'
      : filteredWorkers.map(entry => {
          const config = entry.config || {};
          const badge = entry.builtin ? '<span class="schema-badge">core</span>' : '';
          const toolSummary = config.tools === '*'
            ? 'All tools'
            : (config.tools || []).map(t => `<code>${escapeHtml(t)}</code>`).join('');
          return `
            <article class="schema-card">
              <header>
                <div>
                  <strong>${escapeHtml(entry.name)}</strong>
                  ${badge}
                </div>
                <small>${escapeHtml(config.description || '')}</small>
              </header>
              <div class="schema-worker-meta">
                <div><span class="schema-meta-label">Default role:</span> ${escapeHtml(config.defaultModelRole || '—')}</div>
                <div><span class="schema-meta-label">Can spawn:</span> ${config.canSpawnWorkers ? 'Yes' : 'No'}</div>
              </div>
              <div class="schema-tools">${toolSummary || 'No tools configured'}</div>
            </article>
          `;
        }).join('');
  };

  const refreshSchemaData = async () => {
    const svc = await resolveSchemaRegistry();
    if (!svc?.listToolSchemas) {
      const toolList = document.getElementById('schema-tool-list');
      if (toolList) toolList.innerHTML = '<div class="schema-empty muted">Schema registry unavailable</div>';
      return;
    }
    try {
      _toolSchemas = svc.listToolSchemas() || [];
      _workerSchemas = svc.listWorkerTypes?.() || [];
      _schemaLoaded = true;
      renderSchemaPanel();
    } catch (e) {
      logger.warn('[Proto] Failed to load schema registry', e?.message || e);
    }
  };

  const setSearch = (query) => {
    _schemaSearch = query || '';
    renderSchemaPanel();
  };

  return {
    refreshSchemaData,
    renderSchemaPanel,
    setSearch,
    isLoaded: () => _schemaLoaded
  };
};
