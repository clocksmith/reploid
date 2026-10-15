/** Deterministic search and extraction over fixed documents, for tests and harnesses. It makes no network
 * request, needs no key and discloses the query to no one. It is not a search provider. */
import { contentWords, sha256Text, wordTokens } from './text.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };

export function createFixedSearchProvider({ documents, now = Date.now, id = 'reploid.fixed-documents', version = '1' }) {
  assert(Array.isArray(documents) && documents.every(doc => doc && ['id', 'url', 'title', 'text'].every(key => typeof doc[key] === 'string' && doc[key]))
    && new Set(documents.map(doc => doc.id)).size === documents.length, 'Fixed documents need unique id, url, title and text');
  const fixed = documents.map(doc => Object.freeze({ ...doc, words: new Set(wordTokens(`${doc.title} ${doc.text}`)) }));
  const hashes = new Map();
  const hash = doc => { if (!hashes.has(doc.id)) hashes.set(doc.id, sha256Text(doc.text)); return hashes.get(doc.id); };
  // The paragraph naming the most query words, first on ties.
  const passage = (doc, terms) => doc.text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
    .map((part, index) => ({ part, index, score: (words => terms.filter(term => words.has(term)).length)(new Set(wordTokens(part))) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].part;
  return Object.freeze({
    id, version,
    async search(query, limits, signal) {
      signal?.throwIfAborted();
      const terms = contentWords(query);
      const ranked = fixed.map(doc => ({ doc, score: terms.filter(term => doc.words.has(term)).length }))
        .filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id)).slice(0, limits.maxResults);
      return Promise.all(ranked.map(async ({ doc }) => ({ sourceId: doc.id, url: doc.url, title: doc.title,
        excerpt: passage(doc, terms), retrievedAt: now(), contentHash: await hash(doc) })));
    },
    async extract({ source, query, signal }) {
      signal?.throwIfAborted();
      const doc = fixed.find(item => item.id === source.sourceId);
      assert(doc, 'Unknown fixed document');
      return { sourceId: doc.id, url: doc.url, text: passage(doc, contentWords(query)), retrievedAt: now(), contentHash: await hash(doc) };
    }
  });
}
