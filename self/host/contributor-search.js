/** Search/extraction through one disclosed contributor, pinned for the complete retrieval. */
import policy from '../vendor/reploid/mesh/web-access-policy.json' with { type: 'json' };

export function createContributorSearch({ network }) {
  const selected = () => network()?.getOffers().find(offer => offer.service === 'bing') || null;
  const identity = offer => `reploid.contributor-search/${offer?.participantId || 'unavailable'}/bing`;
  const provider = Object.freeze({
    get id() { return identity(selected()); }, version: '1', searchProvider: 'contributor-bing', supply: 'contributor', costBearer: 'operator',
    get searchPeer() { return selected()?.participantId ?? null; },
    async search(query, limits, signal, { providerId } = {}) {
      const offer = selected(), owner = network();
      if (!offer || providerId !== identity(offer)) throw new Error('Search contributor changed; allow search again');
      const result = await owner.request(offer, 'search', { query, maxResults: Math.min(limits.maxResults, policy.maxResults) }, signal);
      return { ...result, results: result.results.map(source => ({ ...source, webContributor: offer })) };
    }
  });
  const extractor = Object.freeze({ id: 'reploid.contributor-page-extract', version: '1',
    extract({ source, query, limits, signal, providerId }) {
      if (identity(source.webContributor) !== providerId) throw new Error('Search source belongs to another contributor');
      const owner = network();
      if (!owner) throw new Error('Search contributor disconnected');
      return owner.request(source.webContributor, 'extract', { source: { sourceId: source.sourceId, url: source.url, fetchToken: source.fetchToken },
        query, maxCharacters: Math.min(limits.maxSourceCharacters, policy.maxSourceCharacters) }, signal);
    }
  });
  return Object.freeze({ provider, extractor, available: () => Boolean(selected()) });
}
