import { comparisonSources } from '../../../self/host/document-comparison.js';
import { literalCatalog, calculateCatalog } from '../lexical-catalog/catalog.js';
const START = '\n<reploid-document-sources-v1>\n';
const END = '\n</reploid-document-sources-v1>';
const need = (ok, message) => { if (!ok) throw Error(message); };

export function sourceScopes(messages) {
  const catalog = literalCatalog(messages);
  const documents = new Map();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    const parsed = comparisonSources(message.content);
    for (const document of parsed?.documents ?? []) {
      const prior = documents.get(document.id);
      need(!prior || JSON.stringify(prior) === JSON.stringify(document), 'Conflicting document identity');
      documents.set(document.id, document);
    }
  }
  need(documents.size > 0, 'No validated document sources');
  return [...documents.keys()].map(documentId => ({
    documentId,
    entries: catalog.entries.filter(fact => fact.source.startsWith('U') || fact.source.startsWith(documentId + ':')),
    messages: messages.filter(message => message.role !== 'assistant').map(message => {
      if (message.role !== 'user') return { ...message };
      const parsed = comparisonSources(message.content);
      if (!parsed) return { ...message };
      const start = message.content.indexOf(START) + START.length;
      const end = message.content.lastIndexOf(END);
      // Primary-source subtask: retain user order/constraints, never assistant claims.
      // The final comparison receives the untouched complete ordered conversation.
      const selected = parsed.documents.map(document => document.id === documentId ? document : { ...document, passages: [] });
      return { ...message, content: message.content.slice(0, start) + JSON.stringify(selected) + message.content.slice(end) };
    }),
  }));
}

export async function calculateScope(plan, messages, documentId) {
  const scope = sourceScopes(messages).find(item => item.documentId === documentId);
  need(scope && plan && Object.keys(plan).join(',') === 'operations' && Array.isArray(plan.operations), 'Invalid source-scoped plan');
  const admitted = new Set(scope.entries.map(fact => fact.id));
  for (const operation of plan.operations) {
    need(Array.isArray(operation.args) && operation.args.every(id => admitted.has(id)), 'Operand is outside source scope or precedes its result');
    need(!admitted.has(operation.id), 'Duplicate result identity');
    admitted.add(operation.id);
  }
  return { documentId, ...await calculateCatalog(plan, messages) };
}
