/** Native contributor implementation: public search and fetched passages without browser cookies.
 * Only URLs returned by this worker's search can be extracted, by the same requester and query.
 * The guarded reader checks DNS/redirects and bounds compressed and decoded bytes. */
import { createPageFetcher } from './search/page-fetch.js';
import { extractDocumentText, selectPassage, sha256Text } from '../packages/reploid/src/retrieval/index.js';
import policy from '../packages/reploid/src/mesh/web-access-policy.json' with { type: 'json' };

const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const text = value => extractDocumentText({ body: new TextEncoder().encode(value), contentType: 'text/html' }).text;
const field = (item, key) => text(item.match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`, 'i'))?.[1] || '');

export function createPublicWebWorker({
  searchFetch = createPageFetcher({ allowedTypes: ['text/xml', 'application/rss+xml'], maxBytes: 256000 }).fetchPage,
  pageFetch = createPageFetcher().fetchPage, now = Date.now
} = {}) {
  const grants = new Map();
  const prune = () => { for (const [token, grant] of grants) if (grant.expiresAt <= now()) grants.delete(token); };
  const queryValid = query => typeof query === 'string' && query.trim() && query.length <= policy.maxQueryCharacters;
  return Object.freeze({ service: 'bing', version: '1',
    async search({ query, maxResults }, { signal, requester }) {
      requireValue(queryValid(query) && Number.isInteger(maxResults) && maxResults > 0 && maxResults <= policy.maxResults, 'Invalid search limits');
      prune(); requireValue(grants.size + maxResults <= policy.maxSeen, 'Search result capacity reached');
      const url = new URL('https://www.bing.com/search'); url.searchParams.set('format', 'rss'); url.searchParams.set('q', query);
      const page = await searchFetch(url.href, { signal }); signal?.throwIfAborted();
      const xml = new TextDecoder().decode(page.body);
      requireValue(page.status === 200 && /<rss[\s>]/i.test(xml) && !/<!DOCTYPE|<!ENTITY/i.test(xml), 'Search did not return results');
      const results = [];
      for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
        if (results.length >= maxResults) break;
        let target;
        try { target = new URL(field(item[1], 'link')); } catch { continue; }
        if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) continue;
        const token = crypto.randomUUID(), sourceId = `web-${results.length + 1}`;
        grants.set(token, { requester, query, url: target.href, sourceId, expiresAt: now() + policy.resultTtlMs });
        const excerpt = field(item[1], 'description').slice(0, 1500) || field(item[1], 'title');
        results.push({ sourceId, url: target.href, title: field(item[1], 'title').slice(0, 1000),
          excerpt, contentHash: await sha256Text(excerpt), retrievedAt: now(), fetchToken: token });
      }
      return { results, usage: { provider: 'contributor-bing', requests: 1, costMicroUsd: null } };
    },
    async extract({ source, query, maxCharacters }, { signal, requester }) {
      prune();
      const grant = grants.get(source?.fetchToken);
      requireValue(grant && grant.requester === requester && grant.query === query && grant.url === source.url
        && grant.sourceId === source.sourceId, 'Page is not an authorized search result');
      requireValue(Number.isInteger(maxCharacters) && maxCharacters > 0 && maxCharacters <= policy.maxSourceCharacters, 'Invalid passage limit');
      const page = await pageFetch(grant.url, { signal }); signal?.throwIfAborted();
      const document = extractDocumentText({ body: page.body, contentType: page.contentType });
      const passage = selectPassage({ text: document.text, query, maxCharacters });
      requireValue(passage.text.trim(), 'Page has no extractable text');
      const sha256 = await sha256Text(document.text);
      return { sourceId: grant.sourceId, url: page.url, title: document.title.slice(0, 1000), text: passage.text,
        retrievedAt: now(), contentHash: sha256, document: { url: page.url, status: page.status, contentType: page.contentType,
          characters: document.text.length, sha256, start: passage.start, end: passage.end, bytes: page.body.byteLength }, costMicroUsd: null };
    }
  });
}
