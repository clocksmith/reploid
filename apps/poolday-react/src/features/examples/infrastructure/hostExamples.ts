// Adapts the host's examples decisions (apps/poolday/host/decisions/examples.js) to the Examples page. The peer run
// session and the page's document assistant (host.documents) own execution; this file supplies this browser's
// storage and the clipboard.
import * as decisions from '../../../../../poolday/host/decisions/examples.js';
import type { DocumentServices, DocumentSnapshot, ExamplesServices, RunServices, RunSnapshot } from '../domain/examples';

type Disposable<T> = T & { readonly dispose: () => void };
const { createExamplesRun, createDocumentSearch, createPrismEnhancer, examplesPageCopy } = decisions as unknown as {
  readonly createExamplesRun: (options: object) => Disposable<RunServices>;
  readonly createDocumentSearch: (assistant: unknown, options: object) => Disposable<DocumentServices> | null;
  readonly createPrismEnhancer: (run: RunServices) => (shell: HTMLElement) => () => void;
  readonly examplesPageCopy: () => ExamplesServices['copy'] & { readonly recordsHref: string };
};

const safeStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const hasSessionStorage = () => {
  try {
    return Boolean(window.sessionStorage);
  } catch {
    return false;
  }
};

/** Opening the document assistant fails once the session has closed; the page then offers sequences only. */
const documentAssistant = (host: { readonly documents?: unknown }) => {
  try {
    return host.documents ?? null;
  } catch {
    return null;
  }
};

export function createExamplesServices(product: { readonly host: object }): ExamplesServices {
  const run = createExamplesRun({ storage: safeStorage(), sessionStorageAvailable: hasSessionStorage() });
  const documents = createDocumentSearch(documentAssistant(product.host as { readonly documents?: unknown }), {});
  const { recordsHref, ...copy } = examplesPageCopy();
  // A fresh suggestion every four seconds while the sequence field is empty and not being edited.
  const rotation = window.setInterval(() => {
    if (!document.activeElement?.matches('[data-pool-sequence-input]')) run.rotateSuggestion();
  }, 4000);
  const copyVector = async () => {
    const embedding = run.getSnapshot().result?.embedding;
    if (!embedding?.permitted) return 'The raw embedding is withheld because publication consent was not granted.';
    if (!embedding.vector) return 'The embedding is not available to copy.';
    if (typeof navigator.clipboard?.writeText !== 'function') return 'Clipboard access is unavailable. Open View embedding vector and copy it manually.';
    try {
      await navigator.clipboard.writeText(embedding.vector);
      return 'Embedding vector copied.';
    } catch {
      return 'Copy failed. Open View embedding vector and copy it manually.';
    }
  };
  return {
    copy,
    run,
    documents,
    enhancePrism: createPrismEnhancer(run),
    copyVector,
    recordsHref,
    dispose: () => {
      window.clearInterval(rotation);
      run.dispose();
      documents?.dispose();
    },
  };
}

const still = () => () => undefined;
const noop = () => undefined;
const specimenRun = (state: 'ready' | 'answered' | 'no-provider'): RunServices => {
  const answered: RunSnapshot['result'] = {
    error: false,
    summary: [['Answer ID', 'sha256:3f9a1c0e...7b21d4aa'], ['Status', 'Accepted'], ['Match', 'accepted 1-of-1'], ['Model', 'esm2-t12-35m-ur50d-f32-af32'], ['Dimensions', '480']],
    embedding: { permitted: false, meta: '480 dimensions · Result sha256:9c0d...e1f2 · Raw vector withheld because embedding publication consent was not granted.',
      detailMeta: '480 dimensions · sha256:9c0d...e1f2 · Raw vector withheld', vector: '', withheld: 'The raw embedding is withheld because publication consent was not granted.' },
    output: 'Protein embedding ready\n480 dimensions\nResult sha256:9c0d...e1f2',
    recovery: null,
    contributors: { local: false, summary: [['Shared', '1 contributor tab'], ['Match', '1/1 matched'], ['Policy', 'One peer']], note: '', route: null, excluded: [],
      rows: [{ provider: 'peer-7f3a', status: 'matched', reason: null, tokens: '0', output: 'sha256:5e1b...a9c0' }] },
    raw: '{\n  "status": "completed"\n}',
  };
  const missing: RunSnapshot['result'] = {
    error: true,
    summary: [['Status', 'No provider']],
    embedding: null,
    output: 'No matching provider is currently available\n\nThe request is preserved. Choose a recovery option below.',
    recovery: { kind: 'provider_missing', title: 'No matching browser is ready', message: 'No contributor in "public" is currently advertising ESM-2 35M (Protein). Run here without sharing compute, or keep searching.',
      details: [], actions: [{ id: 'retry_network', label: 'Keep searching', primary: true, href: null }, { id: 'offer_local_provider', label: 'Run on this device', primary: false, href: null }] },
    contributors: { local: false, summary: [['Shared', '0 contributor tabs'], ['Match', 'not accepted'], ['Policy', 'One peer']], note: 'Contributor evidence appears after matching tabs answer.', route: null, excluded: [], rows: [] },
    raw: '{\n  "status": "error"\n}',
  };
  const snapshot: RunSnapshot = {
    models: [{ value: 'esm2-t12-35m-ur50d-f32-af32', label: 'ESM-2 35M (Protein)' }],
    policies: [{ value: 'fastest_receipt', label: 'One peer' }, { value: 'canary_audited', label: 'One peer with audit' }, { value: 'redundant_agreement', label: 'Two matching peers' }, { value: 'ring_quorum_receipt', label: 'Peer quorum' }],
    modelId: 'esm2-t12-35m-ur50d-f32-af32',
    policyId: 'fastest_receipt',
    sequence: state === 'ready' ? '' : 'MAPLALLLLGLVAGA',
    suggestion: 'MAPLALLLLGLVAGA',
    consent: state !== 'ready',
    consentSaved: state !== 'ready',
    feedback: { count: state === 'ready' ? '0 / 1024' : '15 / 1024', message: 'Whitespace is ignored.', invalid: false },
    pack: [['Model identity', 'esm2-t12-35m-ur5...32-wp-v1'], ['Capability', 'Sequence embedding · 480 dimensions'], ['Input', 'Public protein sequence · up to 1024 residues'], ['Work', 'doppler · browser-webgpu'], ['Providers', 'Searching']],
    visual: state === 'ready' ? { state: 'idle', phase: '', message: 'Ready' } : state === 'answered' ? { state: 'complete', phase: 'answer', message: 'Protein embedding verified' }
      : { state: 'error', phase: 'match', message: 'No matching provider is currently available' },
    busy: false,
    outputVisible: state !== 'ready',
    result: state === 'answered' ? answered : state === 'no-provider' ? missing : null,
    focusSequence: 0,
  };
  return { getSnapshot: () => snapshot, subscribe: still, setSequence: noop, setModel: noop, setPolicy: noop, setConsent: noop, rotateSuggestion: noop, useExample: noop, submit: noop, recover: noop };
};

const specimenDocuments = (): DocumentServices => {
  const snapshot: DocumentSnapshot = {
    workflow: 'documents', configured: true, busy: false, status: 'Ready', modelStatus: 'Models selected', modelsChosen: true, trusted: true, setupOpen: false,
    corpus: 'fruit.md · sea.txt', query: 'apple', rerank: false, answerRequested: true, rerankAvailable: true, answerAvailable: true, submitDisabled: false, cancelVisible: false,
    taskClass: 'local-only', shareStatus: 'This task stays on this device.', shareTask: '', shareConsent: false, reviewDisabled: true, taskDisabled: true, preview: null, sendDisabled: true,
    answer: 'Apple trees grow fruit. [1]',
    matches: [{ title: 'fruit.md · characters 1–28', text: 'Apple trees grow fruit here.' }, { title: 'sea.txt · characters 1–23', text: 'Whales live in the sea.' }],
    evidence: '{\n  "execution": "local"\n}',
  };
  return { getSnapshot: () => snapshot, subscribe: still, setWorkflow: noop, setSetupOpen: noop, setModelsFile: noop, setTrusted: noop, configure: noop, addDocuments: noop,
    setQuery: noop, setRerank: noop, setAnswer: noop, search: noop, setTaskClass: noop, setShareTask: noop, reviewShare: noop, setShareConsent: noop, sendShare: noop, cancel: noop, clear: noop };
};

/** Still Examples pages for /design: ready, an answered run, no contributor ready, and a document search. */
export function examplesSpecimenServices(state: 'ready' | 'answered' | 'no-provider' | 'documents'): ExamplesServices {
  const documents = specimenDocuments();
  const sequenceDocuments: DocumentServices = { ...documents, getSnapshot: () => ({ ...documents.getSnapshot(), workflow: 'sequence' }) };
  const fixed = sequenceDocuments.getSnapshot();
  return {
    copy: { name: 'Reploid', body: 'Protein analysis and document search exercise specific model operations.', experiments: [{ id: 'zero', label: 'Zero', href: '/zero' }, { id: 'x', label: 'X', href: '/x' }] },
    run: specimenRun(state === 'documents' ? 'ready' : state),
    documents: state === 'documents' ? documents : { ...sequenceDocuments, getSnapshot: () => fixed },
    enhancePrism: () => () => undefined,
    copyVector: async () => '',
    recordsHref: '/records',
    dispose: noop,
  };
}
