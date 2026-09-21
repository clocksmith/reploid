/**
 * @fileoverview Multithreaded Conversation Workspace for Reploid.
 * Replaces task attempt and revision forms with a 4-area conversational workspace:
 * 1. Thread sidebar (conversations list, unread indicators, + New)
 * 2. Conversation area (chronological messages, streaming output, always-available composer)
 * 3. Network header (connection state, participating devices, model selector, inspector trigger)
 * 4. Contextual inspector (model acquisition, execution placement, contribution limits)
 */

const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderConversationWorkspace() {
  return `
<section class="reploid-chat-workspace" data-chat-workspace aria-label="Conversation workspace">
  <!-- Area 3: Network Header -->
  <header class="chat-network-header" data-network-header>
    <div class="chat-header-left">
      <div class="chat-mesh-status" data-mesh-status>
        <span class="mesh-status-dot is-online" aria-hidden="true"></span>
        <span class="mesh-status-text" data-mesh-label>Mesh Active</span>
        <span class="mesh-peer-count" data-mesh-peers>0 peers</span>
      </div>
      <button class="btn btn-ghost btn-sm chat-invite-btn" type="button" data-mesh-invite>Invite</button>
    </div>

    <div class="chat-header-center">
      <div class="chat-model-pill-wrapper">
        <label for="chat-active-model-select" class="sr-only">Active model</label>
        <select id="chat-active-model-select" class="chat-model-select" data-active-model-select aria-label="Mesh model">
          <option value="">Loading models...</option>
        </select>
        <span class="chat-model-status-badge" data-model-status-badge>Local WebGPU</span>
      </div>
    </div>

    <div class="chat-header-right">
      <div class="chat-contribution-toggle-wrap">
        <button class="btn btn-ghost btn-sm chat-contrib-btn" type="button" data-toggle-contribution title="Toggle resource contribution">
          <span class="contrib-dot" data-contrib-dot></span>
          <span data-contrib-label>Contributing</span>
        </button>
      </div>
      <button class="btn btn-ghost btn-sm chat-inspector-toggle-btn" type="button" data-toggle-inspector aria-expanded="false" title="Open Network & Execution Inspector">
        Inspector
      </button>
    </div>
  </header>

  <div class="chat-main-container">
    <!-- Area 1: Thread Sidebar -->
    <aside class="chat-thread-sidebar" data-thread-sidebar aria-label="Conversations">
      <div class="chat-sidebar-header">
        <h2 class="chat-sidebar-title">Conversations</h2>
        <button class="btn btn-primary btn-sm chat-new-thread-btn" type="button" data-new-thread>+ New</button>
      </div>
      <div class="chat-thread-list" data-thread-list role="list">
        <!-- Thread items rendered dynamically -->
      </div>
    </aside>

    <!-- Area 2: Conversation View -->
    <main class="chat-conversation-area" data-conversation-area aria-label="Current conversation">
      <!-- Conversation Header -->
      <div class="chat-thread-header" data-thread-header>
        <div class="chat-thread-info">
          <h3 class="chat-thread-title" data-thread-title>Select or start a conversation</h3>
          <span class="chat-thread-scope-badge" data-thread-scope hidden>Local</span>
        </div>
        <div class="chat-thread-actions">
          <button class="btn btn-ghost btn-xs" type="button" data-thread-scope-toggle title="Change sharing scope">Scope: <span data-current-scope>Local</span></button>
        </div>
      </div>

      <!-- Chronological Messages Stream -->
      <div class="chat-message-stream" data-message-stream role="log" aria-live="polite">
        <div class="chat-empty-state" data-chat-empty>
          <p class="type-h3">Distributed Intelligence Chat</p>
          <p class="type-caption">Start a conversation across participating WebGPU devices and Doppler models.</p>
        </div>
      </div>

      <!-- Always-available Composer -->
      <footer class="chat-composer-area" data-composer-area>
        <form class="chat-composer-form" data-composer-form>
          <div class="chat-composer-box">
            <textarea
              class="chat-composer-input"
              data-composer-input
              rows="1"
              placeholder="Send a message... (Enter to send, Shift+Enter for newline)"
              required
            ></textarea>
            
            <div class="chat-composer-toolbar">
              <div class="chat-toolbar-left">
                <label class="chat-file-attach-label btn btn-ghost btn-xs" title="Attach text or source files">
                  <input type="file" multiple data-composer-files class="sr-only" accept=".txt,.md,.json,.js,.ts,.html,.css" />
                  <span>Attach</span>
                </label>
                <span class="chat-attachment-count" data-attachment-count hidden></span>
              </div>
              
              <div class="chat-toolbar-right">
                <button class="btn btn-primary btn-sm chat-send-btn" type="submit" data-composer-send>Send</button>
                <button class="btn btn-ghost btn-sm chat-stop-btn" type="button" data-composer-stop hidden>Stop</button>
              </div>
            </div>
          </div>
          <div class="chat-composer-attachments-preview" data-attachments-preview hidden></div>
        </form>
      </footer>
    </main>

    <!-- Area 4: Contextual Inspector (slide-out / drawer) -->
    <aside class="chat-contextual-inspector" data-contextual-inspector hidden aria-label="Contextual inspector">
      <div class="inspector-header">
        <h3 class="inspector-title">Network & Execution</h3>
        <button class="btn btn-ghost btn-xs inspector-close-btn" type="button" data-close-inspector aria-label="Close inspector">✕</button>
      </div>

      <div class="inspector-body">
        <!-- Section 1: Selected Model & Execution Placement -->
        <section class="inspector-section" aria-labelledby="inspector-model-heading">
          <h4 id="inspector-model-heading" class="inspector-section-title">Model & Placement</h4>
          <div class="inspector-card">
            <div class="inspector-row"><span>Model</span><strong data-insp-model-name>-</strong></div>
            <div class="inspector-row"><span>Identity</span><code class="inspector-code" data-insp-model-hash>-</code></div>
            <div class="inspector-row"><span>Placement</span><span class="badge" data-insp-placement>-</span></div>
            <div class="inspector-row"><span>Provider</span><span data-insp-provider>-</span></div>
            <div class="inspector-row"><span>Adapters</span><span data-insp-adapters>None</span></div>
          </div>
        </section>

        <!-- Section 2: Mesh Devices & Availability -->
        <section class="inspector-section" aria-labelledby="inspector-mesh-heading">
          <h4 id="inspector-mesh-heading" class="inspector-section-title">Participating Devices</h4>
          <div class="inspector-card">
            <ul class="inspector-device-list" data-insp-device-list>
              <li>Local Device (Browser WebGPU) • Online</li>
            </ul>
          </div>
        </section>

        <!-- Section 3: Contribution Controls -->
        <section class="inspector-section" aria-labelledby="inspector-contrib-heading">
          <h4 id="inspector-contrib-heading" class="inspector-section-title">Resource Contribution</h4>
          <div class="inspector-card">
            <div class="inspector-row">
              <span>Offer Compute & Storage</span>
              <button class="btn btn-ghost btn-xs" type="button" data-insp-toggle-contrib>Active</button>
            </div>
            <div class="inspector-field">
              <label for="insp-storage-limit">Max Storage (MB)</label>
              <input id="insp-storage-limit" type="number" class="inspector-input" data-insp-storage-limit value="1024" />
            </div>
            <div class="inspector-field">
              <label for="insp-bw-limit">Max Bandwidth (Kbps)</label>
              <input id="insp-bw-limit" type="number" class="inspector-input" data-insp-bw-limit value="5000" />
            </div>
          </div>
        </section>

        <!-- Section 4: Recent Evaluated Improvements -->
        <section class="inspector-section" aria-labelledby="inspector-eval-heading">
          <h4 id="inspector-eval-heading" class="inspector-section-title">Recent Improvements</h4>
          <div class="inspector-card" data-insp-improvement-card>
            <p class="type-caption">No active candidate modifications.</p>
          </div>
        </section>
      </div>
    </aside>
  </div>
</section>
  `.trim();
}

export function bindConversationWorkspace(root, chatSession) {
  const container = root.querySelector('[data-chat-workspace]');
  if (!container || !chatSession) return () => {};

  const find = sel => container.querySelector(sel);
  const findAll = sel => [...container.querySelectorAll(sel)];

  let attachedFiles = [];
  let currentScope = 'local';
  const scopes = ['local', 'invited-mesh', 'public-peers'];

  // 1. Render Model Selector
  const updateModelSelector = state => {
    const select = find('[data-active-model-select]');
    if (!select) return;
    const currentVal = select.value;
    const models = state.models || [];
    select.innerHTML = models.map(m => `
      <option value="${escapeHtml(m.id)}" ${m.id === currentVal ? 'selected' : ''}>
        ${escapeHtml(m.name)}${m.adapters?.length ? ` (+${m.adapters.map(a => a.name).join(', ')})` : ''}
      </option>
    `).join('');

    const activeModel = models.find(m => m.id === select.value) || models[0];
    const badge = find('[data-model-status-badge]');
    if (badge && activeModel) {
      badge.textContent = activeModel.provider === 'peer' ? 'Peer Mesh' : 'Local WebGPU';
    }
  };

  // 2. Render Thread List
  const updateThreadList = state => {
    const list = find('[data-thread-list]');
    if (!list) return;

    if (!state.threads.length) {
      list.innerHTML = '<p class="type-caption chat-no-threads">No conversations yet.</p>';
      return;
    }

    list.innerHTML = state.threads.map(t => {
      const isSelected = t.id === state.selectedId;
      const isRunning = state.runningIds.includes(t.id);
      const lastMsg = t.messages.at(-1)?.content || 'Empty conversation';
      const snippet = lastMsg.slice(0, 45) + (lastMsg.length > 45 ? '...' : '');
      const title = t.purpose || snippet || 'Conversation';

      let statusBadge = '';
      if (isRunning) {
        statusBadge = '<span class="chat-thread-badge is-running" title="Running">Running</span>';
      } else if (t.attempts.at(-1)?.status === 'cancelled') {
        statusBadge = '<span class="chat-thread-badge is-cancelled" title="Cancelled">Stopped</span>';
      }

      return `
        <div class="chat-thread-item ${isSelected ? 'is-selected' : ''}" data-thread-item-id="${escapeHtml(t.id)}" role="button" tabindex="0">
          <div class="chat-thread-item-header">
            <span class="chat-thread-item-title">${escapeHtml(title)}</span>
            ${statusBadge}
          </div>
          <p class="chat-thread-item-snippet">${escapeHtml(snippet)}</p>
        </div>
      `;
    }).join('');

    // Bind click to select thread
    findAll('[data-thread-item-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.threadItemId;
        chatSession.select(id);
      });
    });
  };

  // 3. Render Active Messages Stream
  const updateMessages = state => {
    const stream = find('[data-message-stream]');
    const titleEl = find('[data-thread-title]');
    const scopeEl = find('[data-current-scope]');
    const stopBtn = find('[data-composer-stop]');
    const sendBtn = find('[data-composer-send]');

    const thread = state.activeThread;
    if (!thread) {
      if (titleEl) titleEl.textContent = 'Select or start a conversation';
      if (stream) {
        stream.innerHTML = `
          <div class="chat-empty-state">
            <p class="type-h3">Distributed Intelligence Chat</p>
            <p class="type-caption">Click "+ New" to start a thread across participating devices.</p>
          </div>
        `;
      }
      if (stopBtn) stopBtn.hidden = true;
      if (sendBtn) sendBtn.disabled = true;
      return;
    }

    if (sendBtn) sendBtn.disabled = false;

    // Update Header
    const firstUserMsg = thread.messages.find(m => m.role === 'user')?.content;
    if (titleEl) titleEl.textContent = thread.purpose || firstUserMsg?.slice(0, 40) || 'Conversation';
    if (scopeEl) scopeEl.textContent = thread.permissions?.sharingScope || 'Local';

    // Check if active thread is running
    const isRunning = state.runningIds.includes(thread.id);
    if (stopBtn) stopBtn.hidden = !isRunning;
    if (sendBtn) sendBtn.hidden = isRunning;

    if (!thread.messages.length) {
      stream.innerHTML = `
        <div class="chat-empty-state">
          <p class="type-caption">Send a message to begin.</p>
        </div>
      `;
      return;
    }

    stream.innerHTML = thread.messages.map(m => {
      const isUser = m.role === 'user';
      const isAssistant = m.role === 'assistant';
      const isStreaming = m.status === 'streaming';
      const isCancelled = m.status === 'cancelled';
      const isFailed = m.status === 'failed';

      let executionBadge = '';
      if (isAssistant) {
        const placement = state.placements?.[thread.id];
        let label = 'Local Doppler • WebGPU';
        if (placement?.provider === 'peer') {
          label = `Peer (${placement.peerId || 'Mesh'})`;
        } else if (placement?.tokensPerSec) {
          label = `Local Doppler • ${placement.tokensPerSec} tok/s`;
        }
        if (isCancelled) label += ' (Cancelled)';
        if (isFailed) label += ' (Failed)';
        if (isStreaming) label += ' (Streaming...)';

        executionBadge = `
          <div class="chat-execution-meta">
            <button class="chat-execution-badge" type="button" data-inspect-execution="${escapeHtml(thread.id)}">
              <span class="badge-dot ${isStreaming ? 'is-pulse' : ''}"></span>
              <span>${escapeHtml(label)}</span>
            </button>
          </div>
        `;
      }

      return `
        <div class="chat-message-row ${isUser ? 'is-user' : 'is-assistant'}">
          <div class="chat-message-bubble">
            <div class="chat-message-content">${escapeHtml(m.content || (isStreaming ? '...' : ''))}</div>
            ${executionBadge}
          </div>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    stream.scrollTop = stream.scrollHeight;

    // Bind execution badge clicks to open inspector
    findAll('[data-inspect-execution]').forEach(btn => {
      btn.addEventListener('click', () => {
        openInspector(state);
      });
    });
  };

  // 4. Contextual Inspector Rendering
  const openInspector = state => {
    const insp = find('[data-contextual-inspector]');
    const toggleBtn = find('[data-toggle-inspector]');
    if (!insp) return;

    insp.hidden = false;
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');

    // Populate data
    const thread = state.activeThread;
    const model = state.models?.find(m => m.id === find('[data-active-model-select]')?.value) || state.defaultModel;
    const placement = thread ? state.placements?.[thread.id] : null;

    const modelNameEl = find('[data-insp-model-name]');
    if (modelNameEl) modelNameEl.textContent = model?.name || 'Qwen 3.5';

    const modelHashEl = find('[data-insp-model-hash]');
    if (modelHashEl) modelHashEl.textContent = (model?.identity || 'sha256:fab133...').slice(0, 24) + '...';

    const placementEl = find('[data-insp-placement]');
    if (placementEl) placementEl.textContent = placement?.placement || (model?.provider === 'peer' ? 'Peer Whole Request' : 'Local WebGPU');

    const providerEl = find('[data-insp-provider]');
    if (providerEl) providerEl.textContent = placement?.provider || model?.provider || 'doppler';

    const adaptersEl = find('[data-insp-adapters]');
    if (adaptersEl) {
      adaptersEl.textContent = model?.adapters?.length
        ? model.adapters.map(a => a.name).join(', ')
        : 'None';
    }

    const toggleContribBtn = find('[data-insp-toggle-contrib]');
    if (toggleContribBtn) {
      toggleContribBtn.textContent = state.contribution?.paused ? 'Resume' : 'Pause';
    }
  };

  const closeInspector = () => {
    const insp = find('[data-contextual-inspector]');
    const toggleBtn = find('[data-toggle-inspector]');
    if (insp) insp.hidden = true;
    if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
  };

  // 5. Update Contribution Controls
  const updateContributionState = state => {
    const isPaused = state.contribution?.paused;
    const contribLabel = find('[data-contrib-label]');
    const contribDot = find('[data-contrib-dot]');
    if (contribLabel) contribLabel.textContent = isPaused ? 'Paused' : 'Contributing';
    if (contribDot) {
      contribDot.className = `contrib-dot ${isPaused ? 'is-paused' : 'is-active'}`;
    }

    const inspToggleBtn = find('[data-insp-toggle-contrib]');
    if (inspToggleBtn) inspToggleBtn.textContent = isPaused ? 'Resume' : 'Pause';
  };

  // Main Render Listener
  const render = state => {
    updateModelSelector(state);
    updateThreadList(state);
    updateMessages(state);
    updateContributionState(state);
  };

  // Subscribe to ChatSession
  const unsubscribe = chatSession.subscribe(render);
  render(chatSession.getState());

  // Bind Events:
  // 1. + New Conversation
  find('[data-new-thread]')?.addEventListener('click', () => {
    const modelSelect = find('[data-active-model-select]');
    const state = chatSession.getState();
    const model = state.models.find(m => m.id === modelSelect?.value) || state.defaultModel;
    chatSession.createThread({ model, sharingScope: currentScope });
  });

  // 2. Scope Toggle
  find('[data-thread-scope-toggle]')?.addEventListener('click', () => {
    const nextIdx = (scopes.indexOf(currentScope) + 1) % scopes.length;
    currentScope = scopes[nextIdx];
    const scopeEl = find('[data-current-scope]');
    if (scopeEl) scopeEl.textContent = currentScope;
  });

  // 3. Send Message
  const composerForm = find('[data-composer-form]');
  composerForm?.addEventListener('submit', async e => {
    e.preventDefault();
    const input = find('[data-composer-input]');
    const content = input?.value?.trim();
    if (!content) return;

    let state = chatSession.getState();
    let threadId = state.selectedId;

    // If no thread is selected, create one first
    if (!threadId) {
      const modelSelect = find('[data-active-model-select]');
      const model = state.models.find(m => m.id === modelSelect?.value) || state.defaultModel;
      threadId = chatSession.createThread({ model, sharingScope: currentScope });
    }

    input.value = '';
    attachedFiles = [];
    updateAttachmentsPreview();

    try {
      await chatSession.send(threadId, content, attachedFiles);
    } catch (err) {
      console.error('[ChatWorkspace] Send failed', err);
    }
  });

  // 4. Textarea Enter to Submit, Shift+Enter for Newline
  const textarea = find('[data-composer-input]');
  textarea?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      composerForm?.requestSubmit();
    }
  });

  // 5. Stop Execution
  find('[data-composer-stop]')?.addEventListener('click', () => {
    const state = chatSession.getState();
    if (state.selectedId) {
      chatSession.cancel(state.selectedId);
    }
  });

  // 6. File Attachments
  const fileInput = find('[data-composer-files]');
  const updateAttachmentsPreview = () => {
    const preview = find('[data-attachments-preview]');
    const countEl = find('[data-attachment-count]');
    if (!preview || !countEl) return;

    if (!attachedFiles.length) {
      preview.hidden = true;
      countEl.hidden = true;
      preview.innerHTML = '';
      return;
    }

    countEl.hidden = false;
    countEl.textContent = `${attachedFiles.length} file(s)`;
    preview.hidden = false;
    preview.innerHTML = attachedFiles.map((f, i) => `
      <span class="attachment-pill">
        ${escapeHtml(f.name)} (${f.bytes} B)
        <button type="button" class="btn-remove-attachment" data-remove-attachment="${i}">✕</button>
      </span>
    `).join('');

    findAll('[data-remove-attachment]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.removeAttachment);
        attachedFiles.splice(idx, 1);
        updateAttachmentsPreview();
      });
    });
  };

  fileInput?.addEventListener('change', async () => {
    const files = [...(fileInput.files || [])];
    for (const f of files) {
      const text = await f.text();
      attachedFiles.push({ name: f.name, bytes: f.size, text });
    }
    fileInput.value = '';
    updateAttachmentsPreview();
  });

  // 7. Inspector Toggle & Close
  find('[data-toggle-inspector]')?.addEventListener('click', () => {
    const insp = find('[data-contextual-inspector]');
    if (insp?.hidden) openInspector(chatSession.getState());
    else closeInspector();
  });

  find('[data-close-inspector]')?.addEventListener('click', closeInspector);

  // 8. Toggle Contribution Quick-Button & Inspector Button
  const toggleContribution = () => {
    const state = chatSession.getState();
    chatSession.setContributionPaused(!state.contribution?.paused);
  };

  find('[data-toggle-contribution]')?.addEventListener('click', toggleContribution);
  find('[data-insp-toggle-contrib]')?.addEventListener('click', toggleContribution);

  // 9. Contribution Limits Inputs
  find('[data-insp-storage-limit]')?.addEventListener('change', e => {
    chatSession.updateContributionLimits({ maxStorageMb: Number(e.target.value) });
  });

  find('[data-insp-bw-limit]')?.addEventListener('change', e => {
    chatSession.updateContributionLimits({ maxBandwidthKbps: Number(e.target.value) });
  });

  return () => {
    unsubscribe();
  };
}
