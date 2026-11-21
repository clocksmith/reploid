/** Validate the installed server's complete auxiliary route before invoking any upstream data port. */
import { bindAuxiliaryDisclosure, sameExecutionBinding } from '../../packages/reploid/src/chat/execution-policy.js';
import { disclosureOrigin, serverSearchPath, SEARCH_DISCLOSURE_PROTOCOL } from '../../packages/reploid/src/retrieval/disclosure-path.js';
import { SearchProviderError } from './errors.js';
export function createSearchDisclosure({ search, fetcher, publicOrigin }) {
  let description = null;
  if (publicOrigin && search.kind === 'brave' && search.privacyProtocol === SEARCH_DISCLOSURE_PROTOCOL
    && fetcher.privacyProtocol === 'reploid.page-fetch/v1') {
    const serverOrigin = disclosureOrigin(publicOrigin), searchOrigin = disclosureOrigin(search.disclosureOrigin);
    if (serverOrigin !== publicOrigin) throw Error('Search public origin must be exact');
    description = Object.freeze({ schema: SEARCH_DISCLOSURE_PROTOCOL, serverOrigin, searchOrigin, redirectPolicy: 'same-origin-only' });
  }
  return Object.freeze({ description,
    async verify(body, operation, signal) {
      try {
        if (!description || !body.auxiliaryBinding || typeof body.answer !== 'string') throw Error('Unqualified search disclosure');
        const detail = { operation, id: operation === 'search' ? 'reploid.server-search/brave' : 'reploid.server-page-extract', version: '1', requestId: body.answer,
          ...(operation === 'extract' ? { resourceOrigin: disclosureOrigin(body.url) } : {}) };
        const path = serverSearchPath(detail, description);
        const expected = await bindAuxiliaryDisclosure(body.auxiliaryBinding.policy, detail, path);
        signal?.throwIfAborted();
        if (!sameExecutionBinding(expected, body.auxiliaryBinding)) throw Error('Search disclosure changed');
        return operation === 'extract' ? [detail.resourceOrigin] : null;
      } catch { throw new SearchProviderError('privacy-rejected'); }
    }
  });
}
