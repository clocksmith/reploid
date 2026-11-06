import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../apps/poolday/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../apps/poolday/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { updateModelSelect } from '../../apps/poolday/ui/components/model-select.js';

describe('Conversation workspace', () => {
  let root, session, dispose, service;
  const find = selector => root.querySelector(selector);
  beforeEach(() => {
    history.replaceState(null, '', '/');
    root = document.createElement('div'); document.body.append(root);
    service = createChatTestService();
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]] });
    root.innerHTML = renderConversationWorkspace();
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
  });
  afterEach(async () => { dispose(); await session.close(); root.remove(); });

  it('keeps personal search in the composer and respects turning it off for a single answer', async () => {
    dispose();
    session.createThread({ sharingScope: 'local' });
    const webState = { enabled: true, url: 'https://search.example.test/mcp', status: { message: '' } };
    const webSearch = { enabled: () => true, state: () => webState, subscribe(fn) { fn(webState); return () => {}; } };
    const send = vi.fn(async () => {});
    dispose = bindConversationWorkspace(root, { ...session, send }, { webSearch });
    expect(find('[data-composer-field] [data-search-toggle]')).not.toBeNull();
    expect(find('[data-search-toggle]').getAttribute('aria-pressed')).toBe('true');
    find('[data-search-toggle]').click();
    find('[data-composer-input]').value = 'Without search';
    find('[data-composer-input]').dispatchEvent(new Event('input', { bubbles: true }));
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    expect(send.mock.calls[0]).toHaveLength(3);
    await vi.waitFor(() => expect(find('[data-composer-input]').value).toBe(''));
    find('[data-search-toggle]').click();
    find('[data-composer-input]').value = 'With search';
    find('[data-composer-input]').dispatchEvent(new Event('input', { bubbles: true }));
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][3]).toEqual({ retrieval: {} });
  });

  it('uses linked workspace destinations and restores history without replacing the composer', () => {
    const input = find('[data-composer-input]');
    input.value = 'Keep this draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
    for (const view of ['threads', 'computers', 'settings']) {
      const link = find(`[data-workspace-view="${view}"]`);
      expect(link.tagName).toBe('A');
      expect(new URL(link.href).searchParams.get('view')).toBe(view);
      link.click();
      expect(new URL(location.href).searchParams.get('view')).toBe(view);
      expect(link.getAttribute('aria-current')).toBe('page');
      expect(find('[data-composer-input]')).toBe(input);
      expect(input.value).toBe('Keep this draft');
      expect(find('dialog[open]')).toBeNull();
    }
    history.replaceState(null, '', '/?view=threads'); window.dispatchEvent(new PopStateEvent('popstate'));
    expect(find('[data-threads-dialog]').hidden).toBe(false);
    expect(find('[data-contextual-inspector]').hidden).toBe(true);
    find('[data-close-threads]').click();
    expect(new URL(location.href).searchParams.has('view')).toBe(false);
    expect(input.value).toBe('Keep this draft');
    dispose(); history.replaceState(null, '', '/?view=settings');
    dispose = bindConversationWorkspace(root, session);
    expect(find('[data-contextual-inspector]').hidden).toBe(false);
    expect(find('[data-inspector-pane="settings"]').hidden).toBe(false);
  });

  it('keeps every configured model visible in the picker before discovery without offering an unavailable one', async () => {
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers: [] } }) } });
    dispose = bindConversationWorkspace(root, session);
    const select = find('[data-active-model-select]');
    find('[data-open-model]').click();
    expect(find('[data-model-picker]').open).toBe(true);
    const choices = find('[data-next-model]').nextElementSibling;
    for (const model of CANONICAL_CHAT_MODELS) {
      expect([...select.options].some(option => option.value === model.id)).toBe(true);
      expect(choices.textContent).toContain(model.name);
    }
    const small = [...choices.querySelectorAll('input')].find(input => input.value === CANONICAL_CHAT_MODELS[0].id);
    small.click();
    expect(find('[data-next-model]').value).toBe(small.value);
    expect(small.checked).toBe(true);
    expect(find('[data-change-model]').disabled).toBe(true);
    expect(find('[data-next-model-status]').textContent).toContain('unavailable');
    session.refreshNetwork();
    expect(choices.querySelector('input:checked')).toBe(small);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(service.calls).toHaveLength(0);
  });

  it('updates automatic defaults as capacity arrives, but preserves explicit choices and existing threads', async () => {
    dispose(); await session.close();
    let peers = [];
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }), connect: async () => {} } });
    dispose = bindConversationWorkspace(root, session);
    const [small, medium, large] = CANONICAL_CHAT_MODELS;
    const publish = models => {
      peers = models.map(model => ({ peerId: model.id, model: model.id, modelIdentity: model.identity,
        readiness: 'ready', hasInference: true, availableSlots: 1 }));
      session.setCachedModels([]);
    };
    publish([small]); expect(find('[data-active-model-select]').value).toBe(small.id);
    publish([small, medium]); expect(find('[data-active-model-select]').value).toBe(medium.id);
    publish([small, medium, large]); expect(find('[data-active-model-select]').value).toBe(large.id);
    const select = find('[data-active-model-select]'); select.value = small.id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    publish([small, medium]); expect(select.value).toBe(small.id);
    find('[data-new-thread]').click();
    await vi.waitFor(() => expect(select.value).toBe(medium.id));
    publish([small, medium, large]); expect(select.value).toBe(large.id);
    session.createThread();
    publish([small, medium]);
    expect(session.getState().activeThread.model.id).toBe(large.id);
    expect(find('[data-model-digest]').textContent).toContain(large.name);
  });

  it('chooses local capacity for a local-only new chat even when a preferred model is ready remotely', async () => {
    dispose(); await session.close();
    const [small, , large] = CANONICAL_CHAT_MODELS;
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers: [
      { peerId: large.id, model: large.id, modelIdentity: large.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }
    ] } }), connect: async () => {} } });
    session.setCachedModels([small]);
    dispose = bindConversationWorkspace(root, session);
    expect(find('[data-active-model-select]').value).toBe(large.id);
    find('[data-execution-choice=local]').click();
    expect(find('[data-active-model-select]').value).toBe(small.id);
    expect(service.calls).toHaveLength(0);
  });

  it('fills an editable draft from a starter without sending, and hides starters for existing conversations', async () => {
    const prompts = find('[data-starting-prompts]'), input = find('[data-composer-input]');
    expect(prompts.hidden).toBe(false);
    const prompt = prompts.querySelector('button').textContent;
    prompts.querySelector('button').click();
    expect(input.value).toBe(prompt);
    expect(document.activeElement).toBe(input);
    expect(prompts.hidden).toBe(true);
    expect(service.calls).toHaveLength(0);
    expect(session.getDraft(null).text).toBe(prompt);
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(prompts.hidden).toBe(false);
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    input.value = 'My own question'; input.dispatchEvent(new Event('input', { bubbles: true }));
    find('[data-composer-form]').requestSubmit();
    await vi.waitFor(() => expect(session.getState().activeThread?.attempts[0]?.status).toBe('completed'));
    expect(prompts.hidden).toBe(true);
    find('[data-new-thread]').click();
    await vi.waitFor(() => expect(prompts.hidden).toBe(false));
  });

  it('shows no network capacity for cached weights and persists location changes in an existing thread', async () => {
    const model = CANONICAL_CHAT_MODELS[1];
    session.setCachedModels([model]);
    expect(find('[data-execution-choice=auto]').getAttribute('aria-pressed')).toBe('true');
    find('[data-execution-choice=network]').click();
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-model-status]').textContent).toContain('No network capacity');
    const id = session.createThread({ model, sharingScope: 'local' });
    find('[data-execution-choice=network]').click();
    await vi.waitFor(() => expect(session.getState().activeThread.permissions.executionLocation).toBe('network'));
    expect(session.getState().activeThread.id).toBe(id);
    expect(service.calls).toHaveLength(0);
    expect(find('[data-execution-choice=network]').getAttribute('aria-pressed')).toBe('true');
    find('[data-execution-choice=local]').click();
    await vi.waitFor(() => expect(session.getState().activeThread.permissions.executionLocation).toBe('local'));
    expect(find('[data-model-status]').hidden).toBe(true);
    expect(find('[data-execution-choice=local]').getAttribute('aria-pressed')).toBe('true');
    expect(find('[data-execution-choice=network]').getAttribute('aria-pressed')).toBe('false');
  });

  it('renders its brand link, the inspector and the model control in place, with nothing moved from the shell', () => {
    expect(find('[data-chat-rail-toolbar] [data-thread-rail-brand] > .pool-primary-brand[href="/"]')).not.toBeNull();
    expect(find('[data-chat-rail-toolbar] [data-toggle-thread-rail]')).not.toBeNull();
    expect(find('[data-chat-rail-toolbar] [data-network-trigger-slot] [data-inspector-navigation]')).not.toBeNull();
    expect(find('[data-chat-inspector-slot] > [data-network-rail][data-mounted]')).not.toBeNull();
    expect(find('[data-network-rail] [data-inspector-navigation]')).toBeNull();
    // The selected model's value port and its details live in the workspace's own picker; the inspector has no Model pane.
    expect(find('[data-model-picker] [data-model-control] [data-active-model-select]')).toBe(find('[data-active-model-select]'));
    expect(find('[data-model-picker] [data-model-selection-details] [data-execution-location]')).not.toBeNull();
    expect(find('[data-inspector-pane="model"]')).toBeNull();
    expect(find('[data-threads-dialog] [data-model-control]')).toBeNull();
    expect(find('[data-inspector-pane="settings"] [data-settings-storage-controls] [data-toggle-file-contribution]')).not.toBeNull();
    expect(find('[data-inspector-pane="participants"] [data-production-device] [data-contribution-limits]')).not.toBeNull();
    expect(find('[data-inspector-pane="participants"] [data-toggle-contribution]')).not.toBeNull();
    find('[data-toggle-thread-rail]').click();
    expect(find('[data-threads-dialog]').hidden).toBe(false);
    expect(find('[data-toggle-thread-rail]').getAttribute('aria-current')).toBe('page');
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').hidden).toBe(false);
    expect(find('[data-threads-dialog]').hidden).toBe(true);
    dispose();
    expect(find('[data-thread-rail-brand] > .pool-primary-brand')).not.toBeNull();
    expect(find('[data-model-picker] [data-active-model-select]')).not.toBeNull();
  });

  it('keeps only Computers and Settings in the rail, with model and answer details in context', () => {
    const navigation = find('[data-chat-rail-toolbar] [data-inspector-navigation]');
    expect([...navigation.querySelectorAll('[data-inspector-section]')].map(node => node.dataset.inspectorSection)).toEqual(['participants', 'settings']);
    expect(find('[data-composer-area] [data-open-model]')).not.toBeNull();
    find('[data-open-model]').click();
    expect(find('[data-model-picker]').open).toBe(true);
    expect(find('#chat-model-picker-title').textContent).toBe('Choose a model');
    find('[data-model-picker-close]').click();
    for (const [section, title] of [['participants', 'Computers'], ['settings', 'Settings']]) {
      navigation.querySelector(`[data-inspector-section="${section}"]`).click();
      expect(find('[data-contextual-inspector]').hidden).toBe(false);
      expect(find('#network-inspector-title').textContent).toBe(title);
      expect(find(`[data-inspector-pane="${section}"]`).hidden).toBe(false);
    }
    find('[data-context-indicator]').click();
    expect(find('#network-inspector-title').textContent).toBe('This conversation');
    expect(new URL(location.href).searchParams.get('view')).toBe('conversation');
    expect(find('[data-inspector-pane="participants"] [data-toggle-contribution]')).not.toBeNull();
  });

  it('keeps the composer and draft while network capacity is unavailable', () => {
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-active-model-select]').textContent).toBe(`${CANONICAL_CHAT_MODELS[1].name} · Download required`);
    expect(find('[data-model-status]').hidden).toBe(false);
    expect(find('[data-model-status]').textContent).toBe('Model unavailable.');
    expect(find('[data-model-digest]').textContent).toBe(CANONICAL_CHAT_MODELS[1].name);
    expect(find('[data-open-model]').textContent).not.toContain('Unavailable');
    expect(find('[data-model-control]').hidden).toBe(false);
    expect(find('[data-toggle-contribution]').disabled).toBe(false);
    expect(find('[data-composer-send]').hidden).toBe(false);
    expect(find('[data-retry-connection]').hidden).toBe(false);
    expect(find('[data-contribution-model]').value).toBe(CANONICAL_CHAT_MODELS[1].id);
    expect(find('[data-contextual-inspector]').hidden).toBe(true);
    expect(find('[data-composer-input]').placeholder).toBeTruthy();
    expect(root.textContent).not.toMatch(/Mesh Active|Distributed Intelligence|Contributing|Scope:|Recent Improvements|LoRA/);
  });

  it('offers downloads only after contribution opt-in and does nothing on cancel', async () => {
    expect(find('[data-composer-model-setup]')).toBeNull();
    find('[data-toggle-contribution]').click();
    await vi.waitFor(() => expect(find('[data-download-confirm]').disabled).toBe(false));
    expect(find('[data-model-dialog]').open).toBe(true);
    expect(find('[data-download-size]').textContent).toBe('123 MB download');
    expect(service.calls).toHaveLength(0);
    find('[data-download-cancel]').click();
    expect(find('[data-model-dialog]').open).toBe(false);
    expect(service.calls).toHaveLength(0);
  });

  it('shows declared answer limits before sending, including the history allowance', () => {
    dispose();
    const model = { ...CANONICAL_CHAT_MODELS[1], availability: 'ready' };
    const project = state => ({ ...state, models: [model], answerLimits: [{ selectionId: model.id,
      cells: [{ maxConcurrency: 1, maxPromptTokens: 512, maxAnswerTokens: 255 },
        { maxConcurrency: 1, maxPromptTokens: 1024, maxAnswerTokens: 63 }] }] });
    dispose = bindConversationWorkspace(root, { ...session,
      getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    expect(find('[data-open-limits]')).toBeNull();
    find('[data-open-model]').click();
    expect(find('[data-model-picker]').open).toBe(true);
    expect(find('[data-answer-limit]').hidden).toBe(false);
    expect(find('[data-answer-limit]').textContent).toContain('255 answer tokens for up to 512 input tokens');
    expect(find('[data-answer-limit]').textContent).toContain('63 answer tokens for up to 1024 input tokens');
    expect(find('[data-answer-limit]').textContent).toContain('Input includes conversation history');
    expect(service.calls).toHaveLength(0);
  });

  it('does not ask to change models while an admitted conversation is still running', () => {
    dispose();
    const model = { ...CANONICAL_CHAT_MODELS[1], availability: 'unavailable', networkAvailability: 'unavailable' };
    const project = state => ({ ...state, selectedId: 'running', runningIds: ['running'], models: [model],
      activeThread: { id: 'running', model, messages: [], attempts: [{ id: 'a', status: 'executing' }],
        permissions: { executionLocation: 'network', sharingScope: 'mesh' } } });
    dispose = bindConversationWorkspace(root, { ...session,
      getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    expect(find('[data-model-status]').textContent).toBe('');
    expect(find('[data-composer-status]').hidden).toBe(true);
    expect(find('[data-composer-stop]').hidden).toBe(false);
  });

  it('previews optional capped context and retains each conversation setting', async () => {
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    expect(find('[data-context-enabled]').checked).toBe(true);
    expect(find('[data-context-cap]').value).toBe('16');
    expect(find('[data-context-cap]').disabled).toBe(false);
    find('[data-context-cap]').value = '32';
    find('[data-context-cap]').dispatchEvent(new Event('change', { bubbles: true }));
    const preview = find('[data-context-preview]').textContent;
    expect(preview).toContain('Reploid');
    expect(preview.split(/\s+/u).length).toBeLessThanOrEqual(32);
    expect(find('[data-context-count]').textContent).toContain('Replies are not limited');
    let disabledWhileRunning = false;
    const unsubscribe = session.subscribe(state => {
      if (state.runningIds.length) disabledWhileRunning ||= find('[data-context-enabled]').disabled;
    });
    find('[data-composer-input]').value = 'First question';
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[0].status).toBe('completed'));
    unsubscribe();
    expect(disabledWhileRunning).toBe(true);
    const first = session.getState().activeThread;
    expect(first.systemContext.content).toBe(preview);
    expect(first.attempts[0].request.messages[0]).toEqual({ role: 'system', content: preview });
    const other = session.createThread({ sharingScope: 'local', contextPrompt: { enabled: false } });
    expect(find('[data-context-enabled]').checked).toBe(false);
    session.select(first.id);
    expect(find('[data-context-enabled]').checked).toBe(true);
    expect(find('[data-context-cap]').value).toBe('32');
    find('[data-context-enabled]').checked = false;
    find('[data-context-enabled]').dispatchEvent(new Event('change', { bubbles: true }));
    expect(session.getState().activeThread.systemContext.content).toBe('');
    expect(session.getState().threads.find(item => item.id === other).systemContext.content).toBe('');
  });

  it('lists each exact model variant once, with its routes, providers and reported GPUs underneath', () => {
    dispose();
    const base = CANONICAL_CHAT_MODELS[1];
    const whole = { ...base, executionModes: ['whole-model', 'partition'], availability: 'ready', networkAvailability: 'ready', providerIds: ['peer-a'] };
    const route = { ...whole, selectionId: base.id + '/route', availability: 'ready', networkAvailability: 'ready', providerIds: [],
      partition: { route: { schema: 'reploid.partition-route/v1', stages: [{ participantId: 'peer-b' }, { participantId: 'peer-c' }] } } };
    const adapted = { ...whole, selectionId: base.id + '/adapter', name: 'Named adapter', adapters: [{ id: 'adapter', identity: 'sha256:adapter', name: 'Named adapter' }],
      availability: 'unavailable', networkAvailability: 'unavailable', providerIds: [] };
    const peers = [{ peerId: 'peer-a', model: base.id, modelIdentity: base.identity, readiness: 'ready', hasInference: true, availableSlots: 1,
      hardware: { vendor: 'AMD', device: 'Reported GPU A', description: 'Driver string' } }];
    const project = state => ({ ...state, models: [whole, route, adapted], network: { consumer: { peers }, connections: [{ id: 'peer-a', phase: 'connected' }] } });
    dispose = bindConversationWorkspace(root, { ...session,
      getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    find('[data-open-model]').click();
    const choices = find('[data-next-model]').nextElementSibling;
    // One choice per variant: the base model and its adapter, not one per route.
    expect([...choices.querySelectorAll('[data-choice-name]')].map(node => node.textContent)).toEqual([base.name, 'Named adapter']);
    expect([...choices.querySelectorAll('[data-choice-name]')].map(node => node.textContent).join()).not.toMatch(/Whole model|Distributed/);
    const variantChoice = () => choices.querySelector('.chat-model-choice input:checked');
    expect(variantChoice().value).toBe(base.id);
    // The facts list is gone; the providers disclosure carries both routes and their computers.
    expect(find('[data-model-facts]')).toBeNull();
    const providers = find('[data-model-picker] [data-model-providers]');
    expect(providers.hidden).toBe(false);
    expect([...providers.querySelectorAll('[data-model-route]')].map(node => node.dataset.modelRoute)).toEqual([base.id, route.selectionId]);
    expect(providers.querySelector(`[data-model-route="${base.id}"]`).textContent).toContain('AMD · Reported GPU A');
    expect(providers.textContent).not.toContain('Driver string');
    expect(providers.querySelector(`[data-model-route="${route.selectionId}"]`).textContent).toContain('Stage 1 of 2 · GPU not reported');
    // Choosing the distributed route keeps the same variant entry checked and changes only the route.
    const distributed = providers.querySelector(`[data-model-route-choice][value="${route.selectionId}"]`);
    distributed.checked = true; distributed.dispatchEvent(new Event('change', { bubbles: true }));
    expect(find('[data-next-model]').value).toBe(route.selectionId);
    expect(variantChoice().value).toBe(route.selectionId);
    expect(choices.querySelectorAll('.chat-model-choice input')).toHaveLength(2);
    // The variant's adapter facts, routes and providers sit directly beneath the highlighted variant's choice.
    expect(variantChoice().closest('label').nextElementSibling).toBe(find('[data-model-picker] [data-model-variant-details]'));
    expect(variantChoice().closest('label').nextElementSibling.contains(providers)).toBe(true);
    expect(find('[data-model-adapter-details]').hidden).toBe(true);
    expect(providers.textContent).toContain('Prepare or serve an adapter');
    // The adapter is nested beneath its base, with its own status, version and evidence.
    const adapterChoice = choices.querySelector(`input[value="${adapted.selectionId}"]`).closest('label');
    expect(adapterChoice.hasAttribute('data-choice-adapter')).toBe(true);
    expect(adapterChoice.querySelector('[data-choice-status]').textContent).toBe('No computer serves it now');
    expect(adapterChoice.querySelector('[data-choice-note]').textContent).toBe('No evaluation evidence');
    expect(find('[data-change-model]').disabled).toBe(false);
    find('[data-change-model]').click();
    return vi.waitFor(() => expect(find('[data-model-digest]').textContent).toBe(`${base.name} · Distributed layers`));
  });

  it('labels an adapted model once without merging distinct selections', () => {
    const select = find('[data-active-model-select]');
    updateModelSelect(select, [
      { id: 'base', name: 'Base model' },
      { id: 'base', selectionId: 'adapted', name: 'Named adapter', adapters: [{ name: 'Named adapter' }] },
      { id: 'base', selectionId: 'other', name: 'Base model', adapters: [{ name: 'Other adapter' }] }
    ], { value: 'adapted' });
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['base', 'Base model'], ['adapted', 'Named adapter'], ['other', 'Base model + Other adapter']
    ]);
    expect(select.value).toBe('adapted');
  });

  it('shows observed remote preparation without claiming readiness or asking to reconnect', async () => {
    dispose(); await session.close();
    const peer = { available: true, description: { phase: 'loading',
      offer: { id: CANONICAL_CHAT_MODELS[1].id, identity: CANONICAL_CHAT_MODELS[1].identity } } };
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]],
      swarm: { getState: () => ({ partitionPeers: [peer], consumer: { peers: [] } }) } });
    dispose = bindConversationWorkspace(root, session);
    find('[data-composer-input]').value = 'Keep my question';
    expect(find('[data-model-status]').hidden).toBe(false);
    expect(find('[data-model-status]').textContent).toBe('Model preparing…');
    expect(find('[data-retry-connection]').hidden).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(service.calls).toHaveLength(0);
    peer.available = false; session.refreshNetwork();
    expect(find('[data-model-status]').hidden).toBe(false);
    expect(find('[data-model-status]').textContent).toBe('Model unavailable.');
    expect(find('[data-retry-connection]').hidden).toBe(false);
    expect(find('[data-composer-input]').value).toBe('Keep my question');
  });

  it('uses the selected whole-request model preparation state without treating other models as capacity', async () => {
    dispose(); await session.close();
    const model = CANONICAL_CHAT_MODELS[0], other = CANONICAL_CHAT_MODELS[1];
    const peers = [model, other].map((item, index) => ({ peerId: 'peer-' + index,
      model: item.id, modelIdentity: item.identity, readiness: 'loading',
      hasInference: true, availableSlots: 0 }));
    session = createChatSession({ storage: null, service,
      swarm: { getState: () => ({ consumer: { connectionState: 'connected', peers } }) } });
    dispose = bindConversationWorkspace(root, session);
    const select = find('[data-active-model-select]');
    select.value = model.id; select.dispatchEvent(new Event('change'));
    find('[data-composer-input]').value = 'Keep my question';
    expect(find('[data-retry-connection]').hidden).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);

    peers[0].readiness = 'ready'; peers[0].availableSlots = 1; session.refreshNetwork();
    expect(find('[data-composer-send]').disabled).toBe(false);
    expect(find('[data-retry-connection]').hidden).toBe(true);

    peers.shift(); session.refreshNetwork();
    expect(select.value).toBe(model.id);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-retry-connection]').hidden).toBe(false);
    expect(find('[data-composer-input]').value).toBe('Keep my question');
    expect(service.calls).toHaveLength(0);
  });

  it('starts contribution only after the download confirmation, preserving the chat draft', async () => {
    dispose();
    const setSharing = vi.fn();
    dispose = bindConversationWorkspace(root, { ...session, setSharing,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    find('[data-composer-input]').value = 'Keep this question';
    find('[data-toggle-contribution]').click();
    await vi.waitFor(() => expect(find('[data-download-confirm]').disabled).toBe(false));
    expect(setSharing).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
    find('[data-download-confirm]').click();
    await vi.waitFor(() => expect(setSharing).toHaveBeenCalledWith(true, CANONICAL_CHAT_MODELS[1].id, true));
    expect(find('[data-composer-input]').value).toBe('Keep this question');
    expect(service.calls).toHaveLength(0);
  });

  it('starts directly, appends followups and pins the conversation model', async () => {
    session.createThread({ sharingScope: 'local' });
    const submit = text => {
      find('[data-composer-input]').value = text;
      find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    submit('First message');
    await vi.waitFor(() => expect(session.getState().threads[0]?.attempts[0]?.status).toBe('completed'));
    expect(find('[data-message-stream]').textContent).toContain('Fixture: First message');
    expect(find('[data-active-model-select]').hidden).toBe(true);
    submit('Followup');
    await vi.waitFor(() => expect(session.getState().activeThread.messages).toHaveLength(4));
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[1].status).toBe('completed'));
    expect(service.calls[0].source).toBe(CANONICAL_CHAT_MODELS[1].id);
  });

  it('offers a new model directly without changing an existing thread or draft', async () => {
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    const id = session.createThread({ sharingScope: 'local' });
    find('[data-composer-input]').value = 'Keep this draft';
    find('[data-open-model]').click();
    expect(find('[data-model-picker]').open).toBe(true);
    expect(find('[data-picker-thread-note]').hidden).toBe(false);
    expect(session.getState().selectedId).toBe(id);
    find('[data-change-model]').click();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    expect(session.getState().threads[0].model.id).toBe(CANONICAL_CHAT_MODELS[1].id);
    session.select(id); expect(find('[data-composer-input]').value).toBe('Keep this draft');
  });

  it('keeps the picker blocking edits until a pending model switch has saved the current draft', async () => {
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    dispose();
    let finish;
    const saved = new Promise(resolve => { finish = resolve; });
    const saveDraft = vi.fn().mockImplementationOnce(() => saved).mockResolvedValue(undefined);
    dispose = bindConversationWorkspace(root, { ...session, saveDraft });
    session.createThread({ sharingScope: 'local' });
    find('[data-open-model]').click(); find('[data-change-model]').click();
    await vi.waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(find('[data-model-picker]').open).toBe(true);
    expect(find('[data-change-model]').disabled).toBe(true);
    expect(find('[data-next-model]').disabled).toBe(true);
    finish();
    await vi.waitFor(() => expect(find('[data-model-picker]').open).toBe(false));
    expect(document.activeElement).toBe(find('[data-composer-input]'));
  });

  it('preserves a local-only grant when choosing a model that also has shared capacity', async () => {
    const model = CANONICAL_CHAT_MODELS[1];
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, models: [model], swarm: { getState: () => ({ consumer: {
      peers: [{ peerId: 'peer', model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }]
    } }) } });
    await session.prepareLocalModel(model.id);
    dispose = bindConversationWorkspace(root, session);
    const original = session.createThread({ model, sharingScope: 'local' });
    find('[data-open-model]').click(); find('[data-change-model]').click();
    await vi.waitFor(() => expect(find('[data-model-picker]').open).toBe(false));
    find('[data-composer-input]').value = 'Keep this answer local';
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session.getState().activeThread?.id).not.toBe(original));
    expect(session.getState().activeThread.permissions.executionLocation).toBe('local');
    expect(session.getState().activeThread.permissions.sharingScope).toBe('local');
  });

  it('refreshes an open model picker without replacing a choice whose capacity disappears', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    let peers = [first, second].map((model, index) => ({ peerId: 'peer-' + index, model: model.id,
      modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }));
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, session);
    const id = session.createThread({ model: first });
    find('[data-composer-input]').value = 'Keep this draft';
    find('[data-open-model]').click();
    const next = find('[data-next-model]');
    next.value = second.id; next.dispatchEvent(new Event('change'));
    peers = peers.slice(0, 1); session.refreshNetwork();
    expect(next.value).toBe(second.id);
    expect(next.textContent).toContain('Unavailable');
    expect(find('[data-change-model]').disabled).toBe(true);
    expect(session.getState().selectedId).toBe(id);
    expect(find('[data-composer-input]').value).toBe('Keep this draft');
    peers.push({ peerId: 'peer-1', model: second.id, modelIdentity: second.identity,
      readiness: 'ready', hasInference: true, availableSlots: 1 });
    session.refreshNetwork();
    expect(next.value).toBe(second.id);
    expect(find('[data-change-model]').disabled).toBe(false);
    find('[data-change-model]').click();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    expect(find('[data-active-model-select]').value).toBe(second.id);
    session.select(id);
    expect(session.getState().activeThread.model.id).toBe(first.id);
    expect(find('[data-composer-input]').value).toBe('Keep this draft');
  });

  it('renames, archives, and restores a thread without changing its purpose or draft', async () => {
    const id = session.createThread({ purpose: 'Original instruction' });
    find('[data-composer-input]').value = 'Preserve draft';
    find('[data-rename-thread]').click(); find('[data-thread-name]').value = 'My thread';
    find('[data-rename-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session.getState().activeThread.title).toBe('My thread'));
    expect(session.getState().activeThread.purpose).toBe('Original instruction');
    find('[data-archive-thread]').click();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    find('[data-show-archived]').click(); expect(find('[data-thread-item-id]').textContent).toContain('My thread');
    find('[data-archive-thread]').click();
    await vi.waitFor(() => expect(session.getState().selectedId).toBe(id));
    expect(find('[data-composer-input]').value).toBe('Preserve draft');
  });

  it('keeps drafts separate while selecting threads and starting a new one', () => {
    const first = session.createThread({ purpose: 'First' });
    find('[data-composer-input]').value = 'Draft for first';
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').value).toBe('');
    find('[data-composer-input]').value = 'New draft';
    find('[data-thread-item-id]').click();
    expect(session.getState().selectedId).toBe(first);
    expect(find('[data-composer-input]').value).toBe('Draft for first');
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').value).toBe('New draft');
  });

  it('keeps the stable placeholder and does not create empty stored threads', () => {
    const previous = find('[data-composer-input]').placeholder;
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').placeholder).toBe(previous);
    expect(session.getState().threads).toHaveLength(0);
    expect(find('[data-message-stream]').childElementCount).toBe(0);
    expect(find('[data-conversation-actions] [data-show-archived]')).not.toBeNull();
    // The bar holds four controls; conversation actions live in the Threads dialog.
    expect(find('[data-threads-dialog] [data-conversation-actions] [data-show-archived]')).not.toBeNull();
    expect(find('[data-thread-sidebar] [data-conversation-actions]')).toBeNull();
  });

  it('opens archived threads from conversation actions in the Threads dialog without losing the draft', () => {
    const previous = globalThis.innerWidth;
    Object.defineProperty(globalThis, 'innerWidth', { value: 390, configurable: true });
    try {
      const id = session.createThread({ sharingScope: 'local' });
      session.archiveThread(id);
      find('[data-composer-input]').value = 'Keep my phone draft';
      find('[data-conversation-actions]').open = true;
      find('[data-show-archived]').click();
      expect(find('[data-conversation-actions]').open).toBe(false);
      expect(find('[data-chat-workspace]').hasAttribute('data-threads-open')).toBe(true);
      expect(find('[data-threads-dialog]').hidden).toBe(false);
      expect(find('[data-threads-dialog] [data-thread-item-id]').dataset.threadItemId).toBe(id);
      expect(find('[data-composer-input]').value).toBe('Keep my phone draft');
    } finally { Object.defineProperty(globalThis, 'innerWidth', { value: previous, configurable: true }); }
  });

  it('surfaces execution failures instead of invented answers', async () => {
    service.open = async () => { throw new Error('GPU unavailable'); };
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Hello');
    expect(find('[data-message-stream]').textContent).toContain('This answer could not finish.');
    expect(find('[data-message-stream] [data-activity-detail] pre').textContent).toContain('GPU unavailable');
    expect(find('[data-copy-error]').getAttribute('aria-label')).toBe('Copy error');
    expect(find('[data-message-stream] .chat-message-actions details')).toBeNull();
    expect(find('[data-message-stream]').textContent).not.toContain('Executing via');
  });

  it('shows actual network state and removes its event handlers on teardown', () => {
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').hidden).toBe(false);
    expect(find('[data-contrib-label]').textContent).toBe('Not sharing');
    find('[data-close-inspector]').click();
    dispose();
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').hidden).toBe(true);
  });

  it('keeps another thread running when the selected thread is cancelled', async () => {
    const first = session.createThread({ sharingScope: 'local' }), second = session.createThread({ sharingScope: 'local' });
    const a = session.send(first, 'First'), b = session.send(second, 'Second');
    session.select(first);
    find('[data-composer-stop]').click();
    const [one, two] = await Promise.all([a, b]);
    expect(one.status).toBe('cancelled'); expect(two.status).toBe('completed');
    session.select(second);
    expect(find('[data-message-stream]').textContent).toContain('Fixture: Second');
  });

  it('shows activity only for the executing selected thread and clears it on cancellation and teardown', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const scheduler = { getState: () => ({}), close: async () => {},
      async schedule(request, controls) {
        controls.onDelta('Working');
        await pending;
        return { content: 'Done', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] };
      } };
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, scheduler });
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    const thread = session.createThread({ sharingScope: 'local' });
    const completion = session.send(thread, 'Hello');
    try {
      await vi.waitFor(() => expect(find('[data-composer-field]').dataset.activity).toBe('executing'));
      session.select(null);
      expect(find('[data-composer-field]').dataset.activity).toBe('idle');
      session.select(thread);
      expect(find('[data-composer-field]').dataset.activity).toBe('executing');
      session.cancel(thread);
      expect(find('[data-composer-field]').dataset.activity).toBe('idle');
    } finally { release(); await completion; }
    expect(find('[data-composer-field]').dataset.activity).toBe('idle');
    dispose();
    expect(find('[data-open-model]').dataset.activity).toBe('idle');
  });

  it('retries a failed response as a new attempt and preserves its partial text', async () => {
    let invocation = 0;
    const scheduler = { getState: () => ({}), close: async () => {},
      async schedule(request, controls) {
        controls.onDelta(invocation++ ? 'Recovered answer' : 'Partial answer');
        if (invocation === 1) throw new Error('Contributor disconnected');
        return { content: 'Recovered answer', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] };
      } };
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, scheduler });
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Keep this question');
    expect(find('[data-message-stream]').textContent).toContain('Partial answer');
    find('[data-retry-attempt]').click();
    await vi.waitFor(() => expect(session.getState().activeThread.attempts.at(-1).status).toBe('completed'));
    const result = session.getState().activeThread;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].retryOf).toBe(result.attempts[0].id);
    expect(result.messages.map(message => message.content)).toEqual(['Keep this question', 'Partial answer', 'Recovered answer']);
  });

  it('retains a deliberate new-thread model selection when its capacity disappears', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    let peers = [first, second].map((model, index) => ({ peerId: 'peer-' + index, model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }));
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, session);
    find('[data-active-model-select]').value = second.id;
    find('[data-active-model-select]').dispatchEvent(new Event('change'));
    peers = peers.slice(0, 1); session.refreshNetwork();
    expect(find('[data-active-model-select]').value).toBe(second.id);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-active-model-select]').textContent).toContain('Unavailable');
  });

  it('automatically selects newly available capacity and preserves a thread model when its peer leaves', async () => {
    const model = CANONICAL_CHAT_MODELS[0];
    let peers = [];
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ discoveryScope: 'public', consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-open-model]').dataset.activity).toBe('idle');
    peers = [{ peerId: 'ready-peer', model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }];
    session.refreshNetwork();
    expect(find('[data-active-model-select]').value).toBe(model.id);
    expect(find('[data-composer-send]').disabled).toBe(false);
    expect(find('[data-mesh-invite]').hidden).toBe(true);
    expect(find('[data-open-model]').dataset.activity).toBe('ready');
    session.createThread();
    peers = []; session.refreshNetwork();
    expect(find('[data-open-model]').dataset.activity).toBe('idle');
    expect(find('[data-active-model-select]').value).toBe(model.id);
    expect(find('[data-active-model-select]').hidden).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);
    find('[data-composer-input]').value = 'Keep my draft';
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(find('[data-composer-input]').value).toBe('Keep my draft');
    expect(session.getState().activeThread.attempts).toEqual([]);
    expect(find('[data-model-dialog]').open).toBe(false);
  });

  it('preserves drafts and attachments when selecting a shared model without initiating downloads or disclosing contents', async () => {
    const [small, medium] = CANONICAL_CHAT_MODELS;
    const peers = [small, medium].map((model, index) => ({ peerId: 'peer-' + index, model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }));
    const downloadLocalModel = vi.fn();
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ discoveryScope: 'public', consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, { ...session, downloadLocalModel });
    const input = find('[data-composer-input]');
    input.value = 'Draft with private notes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const fileInput = find('[data-composer-files]');
    Object.defineProperty(fileInput, 'files', { value: [new File(['Private file body'], 'notes.txt', { type: 'text/plain' })], configurable: true });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(find('[data-attachments-preview]').textContent).toContain('notes.txt'));
    find(`[data-production-use="${small.id}"]`).click();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Draft with private notes');
    expect(find('[data-attachments-preview]').textContent).toContain('notes.txt');
    expect(find('[data-active-model-select]').value).toBe(small.id);
    expect(downloadLocalModel).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
    expect(session.getState().threads).toHaveLength(0);
  });
});
