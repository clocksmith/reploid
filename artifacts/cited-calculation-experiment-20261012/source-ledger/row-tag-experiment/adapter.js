import { ledgerCatalog } from '../adapter.js';
import { runCalculation } from '../../calculate.js';

const roleKinds = {
  budget: ['money'], deadline: ['date'], base: ['money'], unitPrice: ['money'],
  additional: ['money'], payment: ['money'], includedAmount: ['money'],
  depositBase: ['money'], depositPercent: ['percent'], start: ['date'],
  duration: ['days', 'weeks'], completion: ['date'],
};
const modifiers = ['condition', 'conflict', 'unknown'];
const relations = ['included', 'excluded', ...modifiers];
const priceRoles = ['base', 'unitPrice', 'additional', 'payment', 'includedAmount'];
const need = (ok, message) => { if (!ok) throw Error(message); };
const uniqueTags = (value, allowed) => Array.isArray(value) && value.length <= 8
  && new Set(value).size === value.length && value.every(tag => typeof tag === 'string' && allowed.includes(tag));

export function sourceRows(messages) {
  const catalog = ledgerCatalog(messages);
  const passageDocument = new Map(catalog.documents.flatMap(d => d.passages.map(p => [p.id, d.documentId])));
  return { catalog,
    facts: catalog.facts.map(fact => ({ ...fact, documentId: passageDocument.get(fact.source) ?? null })),
    passages: catalog.documents.flatMap(d => d.passages.map(p => ({ ...p, documentId: d.documentId }))),
  };
}

export function rowSchema(messages) {
  const rows = sourceRows(messages);
  const tags = [...Object.keys(roleKinds), ...modifiers, ...rows.catalog.documents.map(d => `quantityFor:${d.documentId}`)];
  return [{ type: 'function', function: { name: 'AnnotateSource',
    description: 'Tag supplied rows in their exact order. Return no fact IDs, values, citations or calculated answers. Empty lists mean no selection, never inferred roles.',
    parameters: { type: 'object', additionalProperties: false, required: ['factRoles', 'passageRelations'], properties: {
      factRoles: { type: 'array', minItems: rows.facts.length, maxItems: rows.facts.length,
        items: { type: 'array', uniqueItems: true, maxItems: 8, items: { enum: tags } },
        description: 'One role-tag list for each supplied fact row. Kind/scope must match; question facts supply budget/deadline or explicit quantityFor:document. condition/conflict/unknown modifiers apply only to that row.' },
      passageRelations: { type: 'array', minItems: rows.passages.length, maxItems: rows.passages.length,
        items: { type: 'array', uniqueItems: true, maxItems: 5, items: { enum: relations } },
        description: 'One claim-tag list for each exact supplied passage. These claims do not automatically modify numeric operands or establish entailment.' },
    } } } }];
}

export function compileRows(selection, messages) {
  const rows = sourceRows(messages);
  need(selection && typeof selection === 'object' && !Array.isArray(selection)
    && Object.keys(selection).length === 2 && Object.hasOwn(selection, 'factRoles')
    && Object.hasOwn(selection, 'passageRelations'), 'Exact annotation fields required');
  need(Array.isArray(selection.factRoles) && selection.factRoles.length === rows.facts.length, 'Exact fact-row count required');
  need(Array.isArray(selection.passageRelations) && selection.passageRelations.length === rows.passages.length, 'Exact passage-row count required');
  const docs = new Map(rows.catalog.documents.map(d => [d.documentId, {
    documentId: d.documentId, roles: {}, values: {}, unresolved: [],
  }]));
  const question = {};
  const tags = [...Object.keys(roleKinds), ...modifiers, ...[...docs.keys()].map(id => `quantityFor:${id}`)];
  const selected = [];
  rows.facts.forEach((fact, index) => {
    const chosen = selection.factRoles[index]; need(uniqueTags(chosen, tags), 'Invalid or duplicate fact tags');
    need(priceRoles.filter(role => chosen.includes(role)).length <= 1, 'Conflicting price roles');
    if (chosen.length) selected.push({ id: fact.id, source: fact.source, value: fact.value, kind: fact.kind, tags: [...chosen] });
    for (const role of chosen.filter(role => !modifiers.includes(role))) {
      if (role.startsWith('quantityFor:')) {
        const id = role.slice('quantityFor:'.length), doc = docs.get(id);
        need(doc && fact.kind === 'number' && (!fact.documentId || fact.documentId === id), 'Quantity scope or type mismatch');
        need(!doc.roles.quantity, 'Multiple quantity assignments'); doc.roles.quantity = fact.id; continue;
      }
      need(roleKinds[role]?.includes(fact.kind), 'Role lexical type mismatch');
      if (['budget', 'deadline'].includes(role)) {
        need(!fact.documentId && !question[role], 'Question constraint scope or duplicate mismatch'); question[role] = fact.id; continue;
      }
      const doc = docs.get(fact.documentId); need(doc, 'Document role requires document evidence');
      if (['additional', 'payment', 'includedAmount'].includes(role)) (doc.roles[role] ??= []).push(fact.id);
      else { need(!doc.roles[role], `Multiple ${role} assignments`); doc.roles[role] = fact.id; }
    }
  });
  const claims = rows.passages.map((passage, index) => {
    const chosen = selection.passageRelations[index]; need(uniqueTags(chosen, relations), 'Invalid passage tags');
    return { source: passage.id, tags: [...chosen], entailmentVerified: false };
  }).filter(claim => claim.tags.length);
  const tagged = new Map(selected.map(fact => [fact.id, fact.tags]));
  const unresolved = id => (tagged.get(id) ?? []).some(tag => ['conflict', 'unknown'].includes(tag));
  const conditional = id => (tagged.get(id) ?? []).includes('condition');
  const operations = [];
  const emit = (op, args) => {
    need(operations.length < 30, 'Operation limit exceeded');
    const id = `derived_${operations.length}`; operations.push({ id, op, args }); return id;
  };
  for (const doc of docs.values()) {
    const role = doc.roles;
    need(!(role.base && role.unitPrice), 'Base and unit price are mutually exclusive');
    need(!role.quantity || role.unitPrice, 'Selected quantity requires an explicit unit price');
    const pricing = [role.base, role.unitPrice, role.quantity, ...(role.additional ?? []), ...(role.payment ?? [])].filter(Boolean);
    const priced = !pricing.some(id => unresolved(id) || conditional(id));
    let subtotal = priced ? role.base ?? null : null;
    if (priced && role.unitPrice && role.quantity) subtotal = emit('multiply', [role.unitPrice, role.quantity]);
    if (subtotal) {
      for (const id of role.additional ?? []) subtotal = emit('add', [subtotal, id]);
      for (const id of role.payment ?? []) subtotal = emit('subtract', [subtotal, id]);
    } else doc.unresolved.push('No complete unconditional price basis selected; amount remains unresolved.');
    doc.values.subtotal = subtotal;
    doc.values.headroom = subtotal && question.budget && !unresolved(question.budget)
      ? emit('subtract', [question.budget, subtotal]) : null;
    doc.values.deposit = role.depositBase && role.depositPercent
      && ![role.depositBase, role.depositPercent].some(unresolved)
      ? emit('percent', [role.depositBase, role.depositPercent]) : null;
    doc.values.statedCompletion = role.completion && !unresolved(role.completion) ? role.completion : null;
    doc.values.derivedCompletion = role.start && role.duration && ![role.start, role.duration].some(unresolved)
      ? emit('addCalendarDuration', [role.start, role.duration]) : null;
    doc.allInTotal = null;
  }
  return { rows, selected, claims, question, documents: [...docs.values()], operations };
}

export async function calculateRows(selection, messages, options = {}) {
  const compiled = compileRows(selection, messages);
  const result = await runCalculation({ facts: compiled.rows.catalog.facts, operations: compiled.operations }, messages, options);
  const dependencies = new Map(compiled.rows.facts.map(f => [f.id, [f.id]]));
  for (const op of compiled.operations) dependencies.set(op.id, [...new Set(op.args.flatMap(id => dependencies.get(id)))]);
  const conditions = new Set(compiled.selected.filter(f => f.tags.includes('condition')).map(f => f.id));
  const values = new Map([...compiled.rows.facts.map(f => [f.id, { id: f.id, value: f.value, kind: f.kind, sources: [f.source], derived: false }]),
    ...result.results.map(value => [value.id, value])]);
  const resolve = id => {
    if (!id) return null;
    const value = values.get(id), conditionalFacts = dependencies.get(id).filter(key => conditions.has(key));
    return { ...value, conditionalFacts, conditional: conditionalFacts.length ? true : null };
  };
  return { selected: compiled.selected, passageClaims: compiled.claims,
    question: Object.fromEntries(Object.entries(compiled.question).map(([key, id]) => [key, resolve(id)])),
    documents: compiled.documents.map(d => ({ ...d, values: Object.fromEntries(Object.entries(d.values).map(([key, id]) => [key, resolve(id)])) })),
    operations: compiled.operations,
    semanticAcceptance: 'unqualified', scope: 'Exact source operands and calculations only. Selected roles, clauses, missing conditions and completeness require independent factual review. Null conditionality never establishes unconditionality.' };
}
