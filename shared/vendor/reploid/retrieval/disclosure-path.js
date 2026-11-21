/** Installed HTTP auxiliary route semantics; remote advertisements cannot select upstream recipients. */
const assert = (ok, message) => { if (!ok) throw Error(`Retrieval privacy: ${message}`); };
export const SEARCH_DISCLOSURE_PROTOCOL = 'reploid.search-disclosure/v2';
export const BRAVE_SEARCH_ORIGIN = 'https://api.search.brave.com';
export function disclosureOrigin(value) {
  const url = new URL(value);
  assert(!url.username && !url.password && (url.protocol === 'https:' || url.protocol === 'http:'
    && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)), 'HTTPS origin required (loopback HTTP is test/local only)');
  return url.origin;
}
export function serverSearchPath(detail, { serverOrigin, searchOrigin }) {
  serverOrigin = disclosureOrigin(serverOrigin);
  searchOrigin = disclosureOrigin(searchOrigin);
  const upstream = detail.operation === 'search' ? searchOrigin : disclosureOrigin(detail.resourceOrigin);
  assert(detail.operation === 'search' || detail.operation === 'extract', 'unsupported server operation');
  const id = detail.operation === 'search' ? 'reploid.server-search/brave' : 'reploid.server-page-extract';
  assert(detail.id === id && detail.version === '1', 'selected implementation changed');
  return { schema: 'reploid.auxiliary-path/v1', id, version: '1', hops: [...new Set([serverOrigin, upstream])]
    .map(recipient => ({ recipient, placement: 'remote', disclosure: 'plaintext' })) };
}
