// The Examples page (/examples) on the host's examples decisions with the peer run session and the document assistant
// replaced: local sequence validation, the public-sequence consent, each recovery choice the vanilla page offered, the
// preserved request after a reload, and the document search panel's wording and staging. No real network or model.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import type { DocumentServices, ExamplesServices, RunServices } from '../../apps/poolday-react/src/features/examples/domain/examples';
import { ExamplesPage } from '../../apps/poolday-react/src/features/examples/presentation/ExamplesPage';

const session = vi.hoisted(() => ({ run: vi.fn(), close: vi.fn() }));
vi.mock('../../apps/poolday/host/peer-run-session.js', async (original) => ({
  ...(await original<object>()),
  createPeerRunSession: () => ({ run: session.run, close: session.close }),
}));

// Every page in these tests counts as reloaded, so a stored request is offered back (it never is on a fresh visit).
vi.mock('../../apps/poolday/ui/pool-home/page-identity.js', async (original) => ({
  ...(await original<object>()),
  pageIdentityNavigationType: () => 'reload',
}));

const decisions = await import('../../apps/poolday/host/decisions/examples.js');
const { resetPoolLedgerStore } = await import('../../apps/poolday/ui/pool-home/ledger-store.js');
const { createExamplesRun, createDocumentSearch, projectDocumentSearch, examplesPageCopy } = decisions as unknown as {
  createExamplesRun: (options: object) => RunServices & { dispose: () => void };
  createDocumentSearch: (assistant: unknown, options: object) => (DocumentServices & { dispose: () => void }) | null;
  projectDocumentSearch: (state: object) => Record<string, unknown>;
  examplesPageCopy: () => ExamplesServices['copy'] & { recordsHref: string };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  session.run.mockReset();
  resetPoolLedgerStore();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const fixedRandom = () => 0;
const mount = ({ documents = null }: { documents?: (DocumentServices & { dispose: () => void }) | null } = {}) => {
  const run = createExamplesRun({ storage: localStorage, random: fixedRandom });
  const { recordsHref, ...copy } = examplesPageCopy();
  const services: ExamplesServices = { copy, run, documents, enhancePrism: () => () => undefined, copyVector: async () => '', recordsHref, dispose: () => run.dispose() };
  render(
    <PooldayRoot>
      <ExamplesPage services={services} />
    </PooldayRoot>,
  );
  return run;
};
const surface = () => document.querySelector('[data-pool-run-surface]') as HTMLElement;
const sequence = () => screen.getByRole('textbox', { name: 'Public protein sequence' }) as HTMLTextAreaElement;
const consent = () => screen.getByRole('switch', { name: 'This input may be sent to selected peers' });
const runButton = () => screen.getByRole('button', { name: 'Run model' });

describe('the protein-sequence run', () => {
  it('opens idle with the product name, promise, experiments and the model facts', () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Reploid');
    expect(screen.getByText('Protein analysis and document search exercise specific model operations.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Explore examples' })).toBeTruthy();
    expect(surface().dataset.runState).toBe('idle');
    expect(document.querySelector('[data-pool-run-status]')?.textContent).toBe('Ready');
    expect(document.querySelector('[data-pool-sequence-count]')?.textContent).toBe('0 / 1024');
    expect(sequence().placeholder).toMatch(/^[A-Z]+$/);
    expect(screen.getByText('Sequence embedding · 480 dimensions')).toBeTruthy();
    expect(within(document.querySelector('[data-pool-request-policy]') as HTMLElement).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value))
      .toEqual(['fastest_receipt', 'canary_audited', 'redundant_agreement', 'ring_quorum_receipt']);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(expect.arrayContaining(['Zero', 'X', 'Start with a goal instead']));
    expect(document.querySelector('[data-pool-workflow-switcher]')).toBeNull();
  });

  it('validates locally and never sends input the field marks invalid', async () => {
    mount();
    await userEvent.type(sequence(), 'MZ*');
    expect(sequence().getAttribute('aria-invalid')).toBe('true');
    expect(document.body.textContent).toContain('non-canonical');
    await userEvent.click(consent());
    await userEvent.click(runButton());
    expect(surface().dataset.runState).toBe('idle');
    expect(session.run).not.toHaveBeenCalled();
    await userEvent.clear(sequence());
    await userEvent.type(sequence(), '  M A G  ');
    expect(document.querySelector('[data-pool-sequence-count]')?.textContent).toBe('3 / 1024');
    expect(screen.getByText('Whitespace is ignored.')).toBeTruthy();
  });

  it('fills the suggested example and refuses to send it before the public consent', async () => {
    mount();
    const suggestion = sequence().placeholder;
    await userEvent.click(screen.getByRole('button', { name: 'Use example' }));
    expect(sequence().value).toBe(suggestion);
    expect(document.activeElement).toBe(sequence());
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(surface().dataset.runState).toBe('error'));
    expect(session.run).not.toHaveBeenCalled();
    expect(document.querySelector('[data-pool-run-raw]')?.textContent).toContain('sequence_public_consent_required');
  });

  it('runs a confirmed sequence, remembers the consent and withholds the raw vector without publication consent', async () => {
    session.run.mockResolvedValue({ status: 'completed', transport: 'webrtc_peer_room_local', receiptHash: 'sha256:abc', policyId: 'fastest_receipt',
      sequenceResultHash: 'sha256:result', embeddingDimensions: 3, sequenceOutput: { pooledEmbedding: [0.1, 0.2, 0.3] },
      agreement: { accepted: true, acceptedProviderCount: 1, requiredAgreement: 1, receiptHashes: ['sha256:abc'] },
      receiptPayloads: [{ fromPeerId: 'peer-1', body: { receiptHash: 'sha256:abc', providerId: 'provider-1', receipt: { outputHash: 'sha256:out' } } }] });
    mount();
    await userEvent.type(sequence(), 'MAPLA');
    await userEvent.click(consent());
    expect(screen.getByText('Saved')).toBeTruthy();
    expect(localStorage.getItem('reploid.pool.sequence-public-consent.v1')).toBe('true');
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(surface().dataset.runState).toBe('complete'));
    expect(session.run.mock.calls[0][0]).toMatchObject({ lane: 'sequence', sequence: 'MAPLA', policyId: 'fastest_receipt' });
    expect(document.querySelector('[data-pool-run-status]')?.textContent).toBe('Protein embedding verified');
    expect(screen.getByRole('heading', { name: 'Embedding ready' })).toBeTruthy();
    expect(document.querySelector('[data-pool-embedding-meta]')?.textContent).toContain('Raw vector withheld because embedding publication consent was not granted.');
    expect(document.querySelector('[data-pool-embedding-vector]')).toBeNull();
    expect((screen.getByRole('button', { name: 'Copy vector' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByRole('table', { name: 'Answer contributors' })).getByText('matched')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Recent jobs' }).getAttribute('href')).toMatch(/^\/records\?room=/);
  });

  it('offers recovery when no contributor is ready, and local execution only after its own consent', async () => {
    session.run.mockRejectedValueOnce(Object.assign(new Error('No provider'), { code: 'peer_provider_not_found' }));
    mount();
    await userEvent.type(sequence(), 'MAPLA');
    await userEvent.click(consent());
    await userEvent.click(runButton());
    await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'No matching browser is ready' })).toBeTruthy());
    expect(document.querySelector('[data-pool-run-status]')?.textContent).toBe('No matching provider is currently available');
    expect(screen.getByRole('link', { name: 'Invite a contributor' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Run on this device' }));
    expect(screen.getByRole('heading', { name: 'Run on this device?' })).toBeTruthy();
    expect(session.run).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'No matching browser is ready' })).toBeTruthy();
    session.run.mockResolvedValueOnce({ status: 'completed', transport: 'local_capsule', receiptHash: 'sha256:local', outputText: 'local' });
    await userEvent.click(screen.getByRole('button', { name: 'Run on this device' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download and run here' }));
    await vi.waitFor(() => expect(surface().dataset.runState).toBe('complete'));
    expect(session.run.mock.calls[1][0]).toMatchObject({ localExecution: true, sequence: 'MAPLA' });
    expect(document.querySelector('[data-pool-run-status]')?.textContent).toBe('Completed on this device');
  });

  it('asks what to do with a request preserved before a reload, and never resends it on its own', async () => {
    const { getPeerRoomId, getPeerRelayMode } = await import('../../apps/poolday/host/product-context.js');
    sessionStorage.setItem('reploid.pool.pending-request.v1', JSON.stringify({ version: 1, lane: 'sequence', sequence: 'MAPLA', selectedModelId: 'esm2-t12-35m-ur50d-f32-af32',
      policyId: 'fastest_receipt', researchSubmission: null, roomId: getPeerRoomId(), relay: getPeerRelayMode(), sensitivity: 'public', startedAt: new Date().toISOString() }));
    mount();
    expect(screen.getByRole('heading', { name: 'Previous request was interrupted' })).toBeTruthy();
    expect(sequence().value).toBe('MAPLA');
    expect(session.run).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(document.querySelector('[data-pool-run-status]')?.textContent).toBe('Ready for a new request');
    expect(sessionStorage.getItem('reploid.pool.pending-request.v1')).toBeNull();
  });
});

/** A document assistant that records calls and builds a fresh state on each read, as the real one does. */
function fakeAssistant(initial: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = { configured: false, corpus: null, busy: false, status: '', hasReranker: false, hasGenerator: false, result: null,
    history: [], delegation: { taskClass: 'local-only', available: false, preview: null }, ...initial };
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    set: (next: Record<string, unknown>) => { state = { ...state, ...next }; },
    getState: () => ({ ...state }),
    configure: (value: unknown) => { calls.push(['configure', value]); state = { ...state, configured: true, hasReranker: true, hasGenerator: true }; },
    setDocuments: async (value: unknown) => { calls.push(['setDocuments', value]); },
    search: async (value: unknown) => {
      calls.push(['search', value]);
      state = { ...state, result: { query: 'apple', matches: [{ sources: ['fruit.md'], start: 0, end: 12, text: 'Apples grow.' }], answer: { text: 'Apples grow. [1]' }, execution: 'local' } };
    },
    setTaskClass: (value: unknown) => { calls.push(['setTaskClass', value]); },
    withdrawDelegation: () => undefined,
    prepareDelegation: async () => undefined,
    approveDelegation: async () => undefined,
    cancel: () => undefined,
    clear: () => { calls.push(['clear', null]); state = { ...state, result: null, corpus: null }; },
  };
}

describe('the document search', () => {
  it('words its states as the vanilla panel did', () => {
    expect(projectDocumentSearch({ configured: false, busy: false })).toMatchObject({ status: 'Choose models to start.', modelStatus: 'No models selected', corpus: 'No documents', submitDisabled: true });
    expect(projectDocumentSearch({ configured: true, busy: false })).toMatchObject({ status: 'Add documents to start.', modelStatus: 'Models selected' });
    expect(projectDocumentSearch({ configured: true, busy: true, status: 'Embedding', corpus: { documents: [{ sources: ['a.md'] }] } }))
      .toMatchObject({ status: 'Preparing search', corpus: 'a.md', cancelVisible: true, submitDisabled: true });
    expect(projectDocumentSearch({ configured: true, delegation: { taskClass: 'derived-remote', available: true } }).shareStatus)
      .toBe('Write only the information you approve for sharing. Source files stay here.');
  });

  it('switches workflows, requires publisher trust, searches with the chosen options and clears', async () => {
    const assistant = fakeAssistant();
    const timers: Array<() => void> = [];
    const documents = createDocumentSearch(assistant, { setTimer: (callback: () => void) => { timers.push(callback); return 1; }, clearTimer: () => undefined,
      readAttachments: async (files: File[]) => files.map((file) => ({ name: file.name })) })!;
    mount({ documents });
    expect(document.querySelector('[data-pool-home-ask-form]')).toBeTruthy();
    await userEvent.click(screen.getByRole('radio', { name: 'Document search' }));
    expect(document.querySelector('[data-pool-home-ask-form]')).toBeNull();
    expect(document.querySelector('[data-document-status]')?.textContent).toBe('Choose models to start.');
    expect((document.querySelector('[data-document-setup]') as HTMLDetailsElement).open).toBe(true);
    const settings = new File(['{"models":[]}'], 'models.json', { type: 'application/json' });
    await userEvent.upload(document.querySelector('[data-document-models]') as HTMLInputElement, settings);
    await userEvent.click(screen.getByRole('button', { name: 'Use models' }));
    await vi.waitFor(() => expect(document.querySelector('[data-document-status]')?.textContent).toBe('Confirm you trust the model publishers first'));
    await userEvent.click(screen.getByRole('switch', { name: 'I trust these publishers to supply model files.' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use models' }));
    await vi.waitFor(() => expect(document.querySelector('[data-document-model-status]')?.textContent).toBe('Models selected'));
    expect(assistant.calls[0]).toEqual(['configure', { models: [] }]);
    expect((document.querySelector('[data-document-setup]') as HTMLDetailsElement).open).toBe(false);
    await userEvent.upload(document.querySelector('[data-document-files]') as HTMLInputElement, [new File(['x'], 'fruit.md', { type: 'text/plain' })]);
    await vi.waitFor(() => expect(assistant.calls.some(([name]) => name === 'setDocuments')).toBe(true));
    assistant.set({ corpus: { documents: [{ sources: ['fruit.md'] }] } });
    timers.forEach((tick) => tick());
    await vi.waitFor(() => expect(document.querySelector('[data-document-corpus]')?.textContent).toBe('fruit.md'));
    await userEvent.type(screen.getByRole('textbox', { name: 'Question' }), 'apple');
    await userEvent.click(screen.getByRole('switch', { name: 'Write an answer with references' }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-document-result]')).toHaveLength(1));
    expect(assistant.calls.find(([name]) => name === 'search')?.[1]).toEqual({ query: 'apple', rerank: false, generateAnswer: true });
    expect(screen.getByText('fruit.md · characters 1–12')).toBeTruthy();
    expect(document.querySelector('[data-document-answer-output]')?.textContent).toContain('Apples grow. [1]');
    await userEvent.click(screen.getByRole('radio', { name: 'Protein sequences' }));
    expect(document.querySelector('[data-document-search]')).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: 'Document search' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear documents' }));
    expect(document.querySelectorAll('[data-document-result]')).toHaveLength(0);
    expect((screen.getByRole('textbox', { name: 'Question' }) as HTMLInputElement).value).toBe('');
    documents.dispose();
  });
});
