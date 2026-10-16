import type { SearchProvider, RetrievalLimits, SearchResult, SearchUsage } from '../vendor/reploid/retrieval/index.js';

/** Search discovers URLs; fetch reads a known URL. A host may implement either through an API,
 * MCP service, extension or automation bridge. Binding this port does not grant disclosure. */
export interface WebAccess {
  readonly id: string;
  search(query: string, limits: RetrievalLimits, signal?: AbortSignal):
    Promise<SearchResult[] | { results: SearchResult[]; usage?: SearchUsage }>;
  /** Return a Fetch-compatible Response; obey the caller's credentials/redirect/signal options.
   * Rendered-page bridges must return the actual document URL, content type and captured content.
   * A host must not supply signed-in/private page contents under a public-page grant. */
  fetch(url: string, options?: RequestInit): Promise<Response>;
}
export function createProviderWebAccess(options: { provider: SearchProvider; fetch?: WebAccess['fetch'] }): WebAccess;
export function createBrowserWebAccess(options: {
  bridge: WebAccess;
  /** Synchronous check before dispatch and before returning a result. */
  authorized(request: { id: string; operation: 'search' | 'fetch'; target: string }): boolean;
}): WebAccess;
