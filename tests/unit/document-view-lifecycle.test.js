import { describe, it, expect, vi } from 'vitest';
import { bindDocumentSearch, renderDocumentSearch } from '../../self/ui/pool-home/document-search.js';

describe('Document view lifetime', () => {
  it('detaches without cancelling, restores the draft, and displays work still in progress', () => {
    const root = document.createElement('div'), viewState = {};
    const state = { configured: true, busy: true, status: 'Embedding', corpus: { documents: [{ sources: ['notes.txt'] }] },
      result: null, history: [], delegation: { taskClass: 'local-only', available: false } };
    const workflow = { getState: () => state, cancel: vi.fn() };
    root.innerHTML = renderDocumentSearch();
    let dispose = bindDocumentSearch(root, workflow, { viewState });
    root.querySelector('[data-document-query]').value = 'Find the exclusions';
    dispose(); expect(workflow.cancel).not.toHaveBeenCalled();
    root.innerHTML = renderDocumentSearch();
    dispose = bindDocumentSearch(root, workflow, { viewState });
    expect(root.querySelector('[data-document-search]').hidden).toBe(false);
    expect(root.querySelector('[data-document-query]').value).toBe('Find the exclusions');
    expect(root.querySelector('[data-document-cancel]').hidden).toBe(false);
    root.querySelector('[data-document-cancel]').click(); expect(workflow.cancel).toHaveBeenCalledTimes(1);
    dispose();
  });
});
