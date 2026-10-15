// Primitive specimens show each building block and its variants. Composition specimens are
// rendered by the product modules themselves, so the page shows the markup the app ships.

const UI = '/ui/pool-home/';
const from = (file, name, ...args) => async () => (await import(UI + file))[name](...args);

const strip = (items) => `<div class="pool-row pool-gap-md">${items.join('')}</div>`;
// Every specimen names its class the same way: lowercase, monospace, as written in markup.
const name = (text) => `<code class="pool-mono pool-caption pool-muted">${text}</code>`;
const PRIMITIVES = [
  { id: 'surfaces', title: 'Surfaces: pool-surface, pool-card, pool-well, pool-divider, pool-list', render: async () => `<div class="pool-columns">
    <section class="pool-surface pds-pad pool-stack pool-gap-sm">${name('pool-surface')}<p class="pool-small">Raised material. The composition owns padding.</p></section>
    <section class="pool-card pool-stack pool-gap-sm">${name('pool-card')}<p class="pool-small">Raised material with its own padding.</p></section>
    <div class="pool-well pool-stack pool-gap-sm">${name('pool-well')}<p class="pool-small">Inset area for grouped or quoted content.</p></div>
    <div class="pool-stack pool-gap-sm">${name('pool-list')}<ul class="pool-list pool-small"><li>First</li><li>Second</li><li>Third</li></ul>${name('pool-divider')}<hr class="pool-divider"></div>
  </div>` },
  { id: 'buttons', title: 'Buttons: pool-button + btn-primary, btn-ghost, pool-icon', render: async () => strip([
    '<button class="pool-button" type="button">Button</button>',
    '<button class="pool-button btn-primary" type="button">Primary</button>',
    '<button class="pool-button btn-ghost" type="button">Ghost</button>',
    '<button class="pool-button" type="button" aria-pressed="true">Pressed</button>',
    '<button class="pool-button btn-ghost" type="button" aria-current="true">Current</button>',
    '<button class="pool-button pool-icon" type="button" aria-label="Add">+</button>',
    '<button class="pool-button btn-primary pool-icon" type="button" aria-label="Send">↑</button>',
    '<button class="pool-button" type="button" disabled>Disabled</button>'
  ]) },
  { id: 'fields', title: 'Fields: pool-input, pool-bare, pool-file, pool-switch', render: async () => `<div class="pool-columns">
    <input class="pool-input pds-pad-sm" type="text" placeholder="pool-input" aria-label="pool-input">
    <select aria-label="Select"><option>Select</option><option>Second</option></select>
    <textarea aria-label="Text area" placeholder="Text area"></textarea>
    <div class="pool-input pool-focus-within pool-row pds-pad-sm"><input class="pool-bare pool-grow" placeholder="pool-bare inside a field" aria-label="Bare field"><label class="pool-button btn-ghost pool-icon pool-file" title="Attach">⎘<input type="file" aria-label="Attach"></label></div>
    <label class="pool-row pool-small"><input type="checkbox" checked> Checkbox</label>
    <div class="pool-row pool-small"><button class="pool-switch" type="button" role="switch" aria-checked="true" aria-label="On"><span></span></button> On <button class="pool-switch" type="button" role="switch" aria-checked="false" aria-label="Off"><span></span></button> Off</div>
  </div>` },
  { id: 'choices', title: 'Choices and labels: pool-segmented, pool-chip, pool-badge, pool-dot', render: async () => `<div class="pool-stack pool-gap-md">
    <div class="pool-segmented" role="group" aria-label="Segmented"><button class="pool-segment" type="button" aria-pressed="true">One</button><button class="pool-segment" type="button" aria-pressed="false">Two</button><button class="pool-segment" type="button" aria-pressed="false">Three</button></div>
    <div class="pool-row"><span class="pool-chip">pool-chip</span><span class="pool-chip pool-dot">Ready</span><span class="pool-badge">pool-badge</span><span class="pool-dot pool-small">pool-dot</span><span class="pool-dot pool-dot-open pool-small">pool-dot-open</span></div>
  </div>` },
  { id: 'disclosure', title: 'Disclosure: pool-disclosure', render: async () => `<details class="pool-disclosure" open><summary>Options <span>2 set</span></summary><p class="pool-small">Disclosed content.</p></details>` },
  { id: 'layout', title: 'Layout: pool-stack, pool-row, pool-columns, pool-gap-*, pool-grow', render: async () => `<div class="pool-stack pool-gap-lg">
    <div class="pool-row pool-row-between pds-outline"><span class="pool-chip">pool-row</span><span class="pool-chip">pool-row-between</span></div>
    <div class="pool-row pds-outline"><span class="pool-chip">fixed</span><span class="pool-chip pool-grow">pool-grow</span><span class="pool-chip">fixed</span></div>
    <div class="pool-stack pool-gap-xs pds-outline"><span class="pool-chip">pool-stack</span><span class="pool-chip">pool-gap-xs</span></div>
    <div class="pool-columns pds-outline">${['One', 'Two', 'Three'].map((label) => `<span class="pool-well pool-small">pool-columns: ${label}</span>`).join('')}</div>
  </div>` },
  { id: 'text', title: 'Text: pool-title, pool-heading, pool-subheading, pool-body, pool-small, pool-caption, pool-label, pool-muted, pool-mono, pool-mark', render: async () => `<div class="pool-stack pool-gap-sm">
    <span class="pool-mark">7<sup>7</sup></span>
    <h1 class="pool-title">pool-title</h1><h2 class="pool-heading">pool-heading</h2><h3 class="pool-subheading">pool-subheading</h3>
    <p class="pool-body">pool-body reads at the page size.</p><p class="pool-small">pool-small one step below.</p>
    <p class="pool-caption pool-muted">pool-caption pool-muted</p><span class="pool-label">pool-label</span><code class="pool-mono">pool-mono</code>
  </div>` },
  { id: 'facts', title: 'Facts and prose: pool-facts, pool-prose', render: async () => `<div class="pool-columns">
    <dl class="pool-facts pool-small"><dt>Model</dt><dd>Qwen 3.5 0.8B</dd><dt>Attempt</dt><dd><code>a1b2c3</code></dd></dl>
    <div class="pool-prose pool-body"><h3>Heading</h3><p>A paragraph with <a href="#facts">a link</a>.</p><pre>code block</pre></div>
  </div>` },
  { id: 'feedback', title: 'Feedback: pool-bar, pool-reveal, pool-glass, pool-activity-edge', render: async () => `<div class="pool-stack pool-gap-md">
    <div class="pool-bar" role="img" aria-label="Shares"><span style="--pool-param-share: 0.25"></span><span style="--pool-param-share: 0.75"></span></div>
    <div class="pool-well pool-reveal-host pool-row pool-row-between pool-small">Hover this well<button class="pool-button btn-ghost pool-reveal" type="button">Revealed</button></div>
    <input class="pool-input pool-glass-focus pds-pad-sm" type="text" placeholder="pool-glass-focus: focus me" aria-label="Glass focus">
    ${['idle', 'ready', 'executing'].map((state) => `<div class="pool-activity-edge pool-surface pds-pad pool-small" data-activity="${state}">data-activity="${state}"</div>`).join('')}
  </div>` }
];

export const PRIMITIVE_GROUPS = [{ id: 'primitives', title: 'Primitives', specimens: PRIMITIVES }];
export const COMPOSITION_GROUPS = [
  { id: 'shell', title: 'Shell', specimens: [
    { id: 'nav', title: 'Navigation', page: true, render: from('shell-view.js', 'renderNav', 'work') },
    { id: 'ribbon', title: 'Execution ribbon', render: from('execution-ribbon.js', 'renderExecutionRibbon') }
  ] },
  { id: 'conversation', title: 'Conversation', specimens: [
    { id: 'conversation', title: 'Conversation workspace', page: true, route: 'home',
      render: from('conversation-workspace.js', 'renderConversationWorkspace'), bind: bindConversation },
    { id: 'documents', title: 'Document search', render: from('document-search.js', 'renderDocumentSearch') },
    { id: 'permission-settings', title: 'Remote permission settings', render: from('remote-permission.js', 'renderRemotePermissionSettings') },
    { id: 'permission-dialog', title: 'Remote permission dialog', render: from('remote-permission.js', 'renderRemotePermissionDialog'),
      bind: (root) => root.querySelector('dialog')?.show() }
  ] },
  { id: 'work', title: 'Work', specimens: [
    { id: 'work', title: 'Work surface', render: from('work.js', 'renderWorkSurface') },
    { id: 'improve', title: 'Improve surface', render: from('work.js', 'renderImproveSurface') },
    { id: 'approval', title: 'Approval', render: from('work-approval-panel.js', 'renderApprovalPanel') },
    { id: 'activity', title: 'Activity', render: from('work-activity-list.js', 'renderActivityList') },
    { id: 'tasks', title: 'Task history', render: from('work-task-history.js', 'renderTaskHistory') },
    { id: 'offers', title: 'Tool offers', render: from('work-tool-offers.js', 'renderToolOfferImport') },
    { id: 'sharing', title: 'Operation sharing', render: from('operation-sharing.js', 'renderOperationSharing') },
    { id: 'consent', title: 'Requester consent', render: from('requester-controls.js', 'renderRequesterConsentRows') },
    { id: 'intent', title: 'Requester intent', render: from('requester-controls.js', 'renderRequesterIntentFields') }
  ] },
  { id: 'network', title: 'Network', specimens: [
    { id: 'network', title: 'Network surface', route: 'network', render: from('work.js', 'renderNetworkSurface') },
    { id: 'agents', title: 'Agent network', render: from('agent-network.js', 'renderAgentNetwork') },
    { id: 'peer-ledger', title: 'Peer ledger', render: from('view.js', 'renderPeerLedgerState') },
    { id: 'stats', title: 'Compute node stats', render: from('view.js', 'renderComputeNodeStats') }
  ] },
  { id: 'records', title: 'Records', specimens: [
    { id: 'receipts', title: 'Receipt ledger', render: from('view.js', 'renderReceiptLedger', []) },
    { id: 'record-ledger', title: 'Record ledger', render: from('view.js', 'renderRecordLedger') },
    { id: 'room-activity', title: 'Room activity', render: from('view.js', 'renderRoomActivity') }
  ] },
  { id: 'routes', title: 'Route panels', specimens: [
    { id: 'route-home', title: 'Home', page: true, route: 'home', render: from('view.js', 'renderRoutePanel', 'home') },
    { id: 'route-examples', title: 'Examples', page: true, route: 'examples', render: from('view.js', 'renderRoutePanel', 'examples') }
  ] }
];
export const SPECIMENS = [...PRIMITIVE_GROUPS, ...COMPOSITION_GROUPS].flatMap((group) => group.specimens);

/** The conversation fixture from the chat-rail layout test: two threads, one completed split attempt. */
async function bindConversation(root) {
  const { bindConversationWorkspace } = await import(UI + 'conversation-workspace.js');
  const model = { id: 'qwen', name: 'Qwen 3.5 0.8B', availability: 'ready' };
  const thread = { id: 'thread', title: 'A conversation', model, permissions: { sharingScope: 'mesh' }, grants: [],
    messages: [{ id: 'q', role: 'user', content: 'Jump!' }, { id: 'r', role: 'assistant', attemptId: 'a', content: 'Ready for the challenge.' }],
    attempts: [{ id: 'a', status: 'completed', execution: { placement: 'two-device-layer-partition', participantA: 'c', participantB: 'a',
      requesterId: 'requester', stepSummary: { metrics: { localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } } } },
      retrieval: { outcome: 'retrieved', sources: [{ number: 1, title: 'Doppler runs models with WebGPU', url: 'https://example.org/doppler' },
        { number: 2, title: 'Reploid shares browser capacity', url: 'https://example.org/reploid' }] } }] };
  const state = { participantId: 'requester', models: [model], defaultModel: model, threads: [thread, { ...thread, id: 'old', title: 'Earlier' }],
    activeThread: thread, selectedId: thread.id, runningIds: [],
    network: { consumer: { peerId: 'rt', connectionState: 'connected', peers: [{ peerId: 't-a' }] },
      partitionPeers: [{ transportId: 't-a', participantId: 'a', available: true, description: { index: 1, phase: 'ready', offer: model } }] } };
  const drafts = new Map();
  bindConversationWorkspace(root, { getState: () => state, subscribe(listener) { listener(state); return () => {}; },
    saveDraft: (id, draft) => drafts.set(id, draft), getDraft: (id) => drafts.get(id), select() {}, disconnect() {}, connect() {} });
}

/** Frame mode: render one specimen into this document's .pool-home root. */
export async function renderSpecimen(id, theme) {
  const specimen = SPECIMENS.find((item) => item.id === id);
  const html = document.documentElement;
  const root = document.querySelector('.pool-home');
  html.classList.add('pds-frame');
  if (!specimen?.page) html.classList.add('pds-frame-fit');
  html.dataset.reploidTheme = theme; root.dataset.poolTheme = theme;
  if (specimen?.route) { root.dataset.poolRouteId = specimen.route; html.dataset.poolRouteId = specimen.route; }
  if (!specimen) { root.textContent = `Unknown specimen ${id}`; return; }
  try {
    root.innerHTML = await specimen.render();
    // Components that wait for state start hidden; a specimen shows them.
    for (const element of root.querySelectorAll(':scope > [hidden]')) element.hidden = false;
    await specimen.bind?.(root);
  } catch (error) {
    root.innerHTML = '';
    const message = document.createElement('p'); message.textContent = `Render failed: ${error.message}`; root.append(message);
  }
  if (!specimen.page && window.frameElement) {
    // Positioned descendants such as an open dialog count toward the fitted height.
    const fit = () => {
      const box = root.getBoundingClientRect();
      const bottom = Math.max(box.bottom, ...[...root.querySelectorAll('*')].map((element) => element.getBoundingClientRect().bottom));
      window.frameElement.style.setProperty('--pds-frame-height', `${Math.ceil(bottom - box.top + parseFloat(getComputedStyle(root).paddingBottom))}px`);
    };
    new ResizeObserver(fit).observe(root); fit();
  }
}
