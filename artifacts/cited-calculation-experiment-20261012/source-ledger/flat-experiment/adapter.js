import { ledgerCatalog, calculateLedger } from '../adapter.js';

const roles = {
  base: ['money'], additional: ['money'], credits: ['money'], includedAmounts: ['money'],
  depositBase: ['money'], depositPercent: ['percent'], start: ['date'],
  duration: ['days', 'weeks'], completion: ['date'],
};
const single = new Set(['base', 'depositBase', 'depositPercent', 'start', 'duration', 'completion']);
const relations = ['included', 'excluded', 'condition', 'conflict', 'unknown'];
export const fields = ['budget', 'deadline', 'documents', ...Object.keys(roles), 'relations'];

function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum || value.some(item => typeof item !== 'string')
    || new Set(value).size !== value.length) throw new Error(`Invalid unique ${label} list`);
  return value;
}

export function expandSelection(selection, messages) {
  if (!selection || Array.isArray(selection) || typeof selection !== 'object'
    || Object.keys(selection).length !== fields.length || fields.some(key => !Object.hasOwn(selection, key))) {
    throw new Error('Exact flat ledger fields required');
  }
  const catalog = ledgerCatalog(messages);
  const facts = new Map(catalog.facts.map(fact => [fact.id, fact]));
  const documents = new Map(catalog.documents.map(document => [document.documentId, {
    documentId: document.documentId, base: null, additional: [], credits: [], includedAmounts: [],
    depositBase: null, depositPercent: null, start: null, duration: null, completion: null, relations: [],
  }]));
  const selectedDocuments = list(selection.documents, 8, 'documents');
  if (selectedDocuments.length !== documents.size || selectedDocuments.some(id => !documents.has(id))) {
    throw new Error('Select every actual document exactly once');
  }
  const sourceDocument = new Map(catalog.documents.flatMap(document => document.passages.map(passage => [passage.id, document.documentId])));
  for (const [role, kinds] of Object.entries(roles)) {
    for (const id of list(selection[role], 96, role)) {
      const fact = facts.get(id);
      const document = fact && documents.get(sourceDocument.get(fact.source));
      if (!document || !kinds.includes(fact.kind)) throw new Error(`Unknown or wrong-scope/type ${role} fact: ${id}`);
      if (single.has(role)) {
        if (document[role] !== null) throw new Error(`Multiple ${role} facts for ${document.documentId}`);
        document[role] = id;
      } else document[role].push(id);
    }
  }
  for (const encoded of list(selection.relations, 128, 'relations')) {
    const parts = encoded.split('|');
    if (parts.length !== 3) throw new Error('Relation must be kind|passageId|factId or kind|passageId|-');
    const [relation, passage, affected] = parts;
    const document = documents.get(sourceDocument.get(passage));
    if (!relations.includes(relation) || !document || (affected !== '-' && facts.get(affected)?.source !== passage)) {
      throw new Error('Unknown relation, passage or mismatched affected fact');
    }
    document.relations.push({ relation, passages: [passage], affectedFacts: affected === '-' ? [] : [affected] });
  }
  return { budget: selection.budget, deadline: selection.deadline,
    documents: selectedDocuments.map(id => documents.get(id)) };
}

export async function calculateFlatLedger(selection, messages) {
  return calculateLedger(expandSelection(selection, messages), messages);
}

export function flatSchema(messages) {
  const catalog = ledgerCatalog(messages);
  const nullable = kind => ({ enum: [null, ...catalog.questionFacts.filter(f => f.kind === kind).map(f => f.id)] });
  const properties = {
    budget: { ...nullable('money'), description: 'Question budget fact ID, or null when absent.' },
    deadline: { ...nullable('date'), description: 'Question deadline fact ID, or null when absent.' },
    documents: { type: 'array', items: { enum: catalog.documents.map(d => d.documentId) }, uniqueItems: true,
      minItems: catalog.documents.length, maxItems: catalog.documents.length, description: 'Every source document ID exactly once.' },
  };
  for (const [role, kinds] of Object.entries(roles)) {
    const ids = catalog.documents.flatMap(d => d.facts.filter(f => kinds.includes(f.kind)).map(f => f.id));
    properties[role] = { type: 'array', items: ids.length ? { enum: ids } : { type: 'string' }, uniqueItems: true,
      maxItems: ids.length ? (single.has(role) ? catalog.documents.length : 96) : 0,
      description: `${role}: selected source fact IDs across documents; ${single.has(role) ? 'at most one per document' : 'zero or more per document'}. Empty means not selected, never inferred.` };
  }
  properties.relations = { type: 'array', items: { type: 'string', pattern: '^(included|excluded|condition|conflict|unknown)\\|D[0-9]+:P[0-9]+\\|(-|f[0-9]+)$' },
    uniqueItems: true, maxItems: 128,
    description: 'Source relation claims: kind|passageId|affectedFactId. Use - for a clause with no selected numeric operand. Only supplied passage/fact IDs; affected fact must occur in that passage. No entailment is inferred.' };
  // Values are deliberately not enumerated combinatorially: the validator checks this exact grammar and provenance.
  if (!catalog.documents.some(document => document.passages.length)) properties.relations.maxItems = 0;
  return [{ type: 'function', function: { name: 'SourceLedger',
    description: 'Select source-exact IDs into flat role lists. Arithmetic and report rendering follow strict source validation; no invented facts or calculated answers.',
    parameters: { type: 'object', properties, required: fields, additionalProperties: false } } }];
}
