// Specimens are rendered by the product modules themselves, so the page shows the markup the
// app ships. Material specimens follow the class contracts in docs/style-guide.md.

const UI = '/ui/pool-home/';
const from = (file, name, ...args) => async () => (await import(UI + file))[name](...args);

const strip = (items) => `<div class="pds-strip">${items.join('')}</div>`;
const MATERIALS = [
  { id: 'pool-button', title: 'Buttons', render: async () => strip([
    '<button class="pool-button" type="button">Button</button>',
    '<button class="pool-button btn-primary" type="button">Primary</button>',
    '<button class="pool-button" type="button" aria-pressed="true">Pressed</button>',
    '<button class="pool-button" type="button" disabled>Disabled</button>'
  ]) },
  { id: 'btn', title: 'Element buttons', render: async () => strip([
    '<button class="btn" type="button">Button</button>',
    '<button class="btn btn-primary" type="button">Primary</button>',
    '<button class="btn btn-ghost" type="button">Ghost</button>',
    '<button class="btn btn-op" type="button" data-op="☇">Run</button>',
    '<button class="btn" type="button" disabled>Disabled</button>'
  ]) },
  { id: 'fields', title: 'Fields', render: async () => `<div class="pds-fields">
    <input class="pool-input" type="text" placeholder="pool-input" aria-label="pool-input">
    <input type="text" placeholder="Element input" aria-label="Element input">
    <select aria-label="Select"><option>Select</option><option>Second</option></select>
    <textarea aria-label="Text area" placeholder="Text area"></textarea>
    <label class="pool-focus-within pds-check"><input type="checkbox" checked> Checkbox</label>
    <label class="pool-focus-within pds-check"><input type="radio" name="pds-radio" checked> Radio</label>
    <input type="text" aria-invalid="true" value="Invalid" aria-label="Invalid">
    <input type="text" disabled value="Disabled" aria-label="Disabled">
  </div>` },
  { id: 'surfaces', title: 'Surfaces', render: async () => `<div class="pds-pair">
    <section class="pool-surface pds-pad"><h2 class="type-h2">pool-surface</h2><p>Opaque raised panel. The component owns padding and layout.</p></section>
    <section class="panel"><h2 class="type-h2">panel</h2><p>Element panel with its line edge.</p></section>
  </div>` },
  { id: 'glass', title: 'Glass and activity', render: async () => `<div class="pds-fields">
    <div class="pool-glass pds-pad">pool-glass</div>
    <input class="pool-input pool-glass-focus" type="text" placeholder="pool-glass-focus: focus me" aria-label="Glass focus">
    ${['idle', 'ready', 'executing'].map((state) => `<div class="pool-activity-edge pool-surface pds-pad" data-activity="${state}">data-activity="${state}"</div>`).join('')}
  </div>` },
  { id: 'type', title: 'Type', render: async () => `<div class="pds-type">
    <h1 class="type-h1">Heading one</h1><h2 class="type-h2">Heading two</h2>
    <p>Body text reads at the page size. <strong>Strong</strong>, <small>small</small>, <a href="#type">a link</a> and <code>inline code</code>.</p>
    <p class="type-caption">Caption text</p>
    <pre>pre: monospace block</pre>
  </div>` },
  { id: 'theme-selector', title: 'Segmented control', render: from('theme.js', 'renderThemeSelector') }
];

export const SPECIMEN_GROUPS = [
  { id: 'materials', title: 'Materials and elements', specimens: MATERIALS },
  { id: 'shell', title: 'Shell', specimens: [
    { id: 'nav', title: 'Navigation', page: true, render: from('shell-view.js', 'renderNav', 'home') },
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
export const SPECIMENS = SPECIMEN_GROUPS.flatMap((group) => group.specimens);

/** The conversation fixture from the chat-rail layout test: two threads, one completed split attempt. */
async function bindConversation(root) {
  const { bindConversationWorkspace } = await import(UI + 'conversation-workspace.js');
  const model = { id: 'qwen', name: 'Qwen 3.5 0.8B', availability: 'ready' };
  const thread = { id: 'thread', title: 'A conversation', model, permissions: { sharingScope: 'mesh' }, grants: [],
    messages: [{ id: 'q', role: 'user', content: 'Jump!' }, { id: 'r', role: 'assistant', attemptId: 'a', content: 'Ready for the challenge.' }],
    attempts: [{ id: 'a', status: 'completed', execution: { placement: 'two-device-layer-partition', participantA: 'c', participantB: 'a',
      requesterId: 'requester', stepSummary: { metrics: { localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } } } } }] };
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
