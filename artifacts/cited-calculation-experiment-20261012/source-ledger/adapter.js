import { comparisonSources } from '../../../self/host/document-comparison.js';
import { sourceMap, runCalculation } from '../calculate.js';
import { literalCatalog } from '../lexical-catalog/catalog.js';

const need = (ok, message) => { if (!ok) throw Error(message); };
const exact = (value, keys) => value && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const relations = ['included', 'excluded', 'condition', 'conflict', 'unknown'];
const documentKeys = ['documentId', 'base', 'additional', 'credits', 'includedAmounts',
  'depositBase', 'depositPercent', 'start', 'duration', 'completion', 'relations'];

/** Catalog copies sources. It does not infer prices, scope, conditions or truth. */
export function ledgerCatalog(messages) {
  const literals = literalCatalog(messages), sources = sourceMap(messages), documents = new Map();
  for (const message of messages) {
    if (message.role !== 'user') continue;
    for (const document of comparisonSources(message.content)?.documents ?? []) {
      need(!documents.has(document.id) || JSON.stringify(documents.get(document.id)) === JSON.stringify(document), 'Conflicting document identity');
      documents.set(document.id, document);
    }
  }
  need(documents.size > 0 && documents.size <= 8, 'Expected bounded document sources');
  return { facts: literals.facts, spans: literals.spans,
    questionFacts: literals.entries.filter(fact => fact.source.startsWith('U')),
    documents: [...documents.values()].map(document => ({ documentId: document.id, name: document.name,
      passages: document.passages.map(passage => ({ id: passage.id, text: sources.get(passage.id) })),
      facts: literals.entries.filter(fact => fact.source.startsWith(document.id + ':')) })),
    scope: 'Source-exact literals and passages. Relation selection is a model claim, not verified entailment.' };
}

function reference(ids, nullable = false) {
  return nullable ? { anyOf: [{ type: 'null' }, { type: 'string', enum: ids }] }
    : { type: 'string', enum: ids };
}

/** The model selects source roles; it never constructs arithmetic expressions. */
export function ledgerSchema(messages) {
  const catalog = ledgerCatalog(messages);
  const choices = (facts, kinds) => facts.filter(fact => kinds.includes(fact.kind)).map(fact => fact.id);
  const list = ids => ({ type: 'array', maxItems: 12, uniqueItems: true, items: reference(ids) });
  const variants = catalog.documents.map(document => {
    const money = choices(document.facts, ['money']);
    return { type: 'object', additionalProperties: false, required: documentKeys,
      properties: { documentId: { const: document.documentId }, base: reference(money, true),
        additional: list(money), credits: list(money), includedAmounts: list(money),
        depositBase: reference(money, true), depositPercent: reference(choices(document.facts, ['percent']), true),
        start: reference(choices(document.facts, ['date']), true),
        duration: reference(choices(document.facts, ['days', 'weeks']), true),
        completion: reference(choices(document.facts, ['date']), true),
        relations: { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false,
          required: ['relation', 'passages', 'affectedFacts'], properties: { relation: { enum: relations },
            passages: { ...list(document.passages.map(passage => passage.id)), minItems: 1 },
            affectedFacts: list(document.facts.map(fact => fact.id)) } } } } };
  });
  return [{ type: 'function', function: { name: 'SourceLedger',
    description: 'Select exact source facts by their stated role and cite relevant passages. Null means unresolved. Included amounts are not additions. A deposit is part of the price. Preserve exclusions, conditions and conflicts. No calculated values or invented facts are accepted.',
    parameters: { type: 'object', additionalProperties: false, required: ['budget', 'deadline', 'documents'],
      properties: { budget: reference(choices(catalog.questionFacts, ['money']), true),
        deadline: reference(choices(catalog.questionFacts, ['date']), true),
        documents: { type: 'array', minItems: variants.length, maxItems: variants.length,
          items: { oneOf: variants } } } } } }];
}

/** Admit source roles and compile only their declared deterministic calculations. */
export async function calculateLedger(input, messages, options = {}) {
  need(exact(input, ['budget', 'deadline', 'documents']), 'Unexpected ledger fields');
  const catalog = ledgerCatalog(messages), facts = new Map(catalog.facts.map(fact => [fact.id, fact]));
  const questionIds = new Set(catalog.questionFacts.map(fact => fact.id));
  const get = (id, kinds, admitted, nullable = false) => {
    if (nullable && id === null) return null;
    const fact = facts.get(id);
    need(typeof id === 'string' && fact && admitted.has(id), 'Unknown or out-of-scope fact');
    need(kinds.includes(fact.kind), 'Wrong fact kind');
    return fact;
  };
  const budget = get(input.budget, ['money'], questionIds, true);
  const deadline = get(input.deadline, ['date'], questionIds, true);
  need(Array.isArray(input.documents) && input.documents.length === catalog.documents.length, 'Every source document requires one ledger');
  const seen = new Set(), operations = [], ledgers = [];
  const emit = (op, args) => {
    need(operations.length < 30, 'Aggregate calculation limit exceeded');
    const id = `ledger_${operations.length}`; operations.push({ id, op, args }); return id;
  };
  for (const selection of input.documents) {
    need(exact(selection, documentKeys), 'Unexpected document ledger fields');
    const document = catalog.documents.find(item => item.documentId === selection.documentId);
    need(document && !seen.has(document.documentId), 'Unknown or duplicate document'); seen.add(document.documentId);
    const admitted = new Set(document.facts.map(fact => fact.id));
    const local = (id, kinds, nullable = false) => get(id, kinds, admitted, nullable);
    const base = local(selection.base, ['money'], true);
    const amounts = {};
    for (const role of ['additional', 'credits', 'includedAmounts']) {
      need(Array.isArray(selection[role]) && selection[role].length <= 12
        && new Set(selection[role]).size === selection[role].length, 'Invalid amount selection');
      amounts[role] = selection[role].map(id => local(id, ['money']));
    }
    const passageIds = new Set(document.passages.map(passage => passage.id));
    need(Array.isArray(selection.relations) && selection.relations.length <= 16, 'Invalid relation list');
    const claims = selection.relations.map(claim => {
      need(exact(claim, ['relation', 'passages', 'affectedFacts']) && relations.includes(claim.relation), 'Invalid source relation');
      need(Array.isArray(claim.passages) && claim.passages.length > 0 && claim.passages.length <= 12
        && new Set(claim.passages).size === claim.passages.length
        && claim.passages.every(id => passageIds.has(id)), 'Unknown or duplicate relation passage');
      need(Array.isArray(claim.affectedFacts) && claim.affectedFacts.length <= 12
        && new Set(claim.affectedFacts).size === claim.affectedFacts.length
        && claim.affectedFacts.every(id => admitted.has(id) && claim.passages.includes(facts.get(id).source)), 'Affected fact must belong to a cited passage');
      return { relation: claim.relation, affectedFacts: claim.affectedFacts,
        passages: claim.passages.map(id => document.passages.find(passage => passage.id === id)), entailmentVerified: false };
    });
    const selectedAmounts = [base?.id, ...amounts.additional.map(fact => fact.id),
      ...amounts.credits.map(fact => fact.id), ...amounts.includedAmounts.map(fact => fact.id)].filter(Boolean);
    const unresolved = [];
    const unsettled = new Set(claims.filter(claim => ['conflict', 'unknown'].includes(claim.relation)).flatMap(claim => claim.affectedFacts));
    const nonUnconditionalPrice = new Set(claims.filter(claim => ['included', 'excluded', 'condition'].includes(claim.relation))
      .flatMap(claim => claim.affectedFacts));
    const countedAmounts = [base?.id, ...amounts.additional.map(fact => fact.id),
      ...amounts.credits.map(fact => fact.id)].filter(Boolean);
    const conflictingRoles = new Set(selectedAmounts).size !== selectedAmounts.length
      || selectedAmounts.some(id => unsettled.has(id));
    const unresolvedPriceRelation = countedAmounts.some(id => nonUnconditionalPrice.has(id));
    if (conflictingRoles) unresolved.push('One amount has conflicting price roles; subtotal and headroom unresolved.');
    if (unresolvedPriceRelation) unresolved.push('A counted price operand is explicitly included, excluded or conditional; unconditional subtotal and headroom unresolved.');
    if (!base) unresolved.push('No base price selected; subtotal and headroom unresolved.');
    let subtotal = base && !conflictingRoles && !unresolvedPriceRelation ? base.id : null;
    if (subtotal) {
      for (const fact of amounts.additional) subtotal = emit('add', [subtotal, fact.id]);
      for (const fact of amounts.credits) subtotal = emit('subtract', [subtotal, fact.id]);
    }
    const headroom = subtotal && budget ? emit('subtract', [budget.id, subtotal]) : null;
    if (!budget) unresolved.push('No user budget selected; headroom unresolved.');
    const depositBase = local(selection.depositBase, ['money'], true);
    const depositPercent = local(selection.depositPercent, ['percent'], true);
    const deposit = depositBase && depositPercent && !unsettled.has(depositBase.id) && !unsettled.has(depositPercent.id)
      ? emit('percent', [depositBase.id, depositPercent.id]) : null;
    if (!deposit) unresolved.push('Deposit operands missing or unresolved; deposit unresolved.');
    const start = local(selection.start, ['date'], true), duration = local(selection.duration, ['days', 'weeks'], true);
    const completion = local(selection.completion, ['date'], true);
    const derivedCompletion = start && duration && !unsettled.has(start.id) && !unsettled.has(duration.id)
      ? emit('addCalendarDuration', [start.id, duration.id]) : null;
    const statedCompletion = completion && !unsettled.has(completion.id) ? completion.id : null;
    if (!statedCompletion && !derivedCompletion) unresolved.push('Completion operands missing or unresolved.');
    ledgers.push({ documentId: document.documentId, name: document.name, selection, claims,
      values: { subtotal, headroom, deposit, statedCompletion, derivedCompletion }, unresolved,
      allInTotal: null, allInTotalReason: 'The ledger does not infer unpriced exclusions or future conditional charges.' });
  }
  const calculated = await runCalculation({ facts: catalog.facts, operations }, messages, options);
  const dependencies = new Map(catalog.facts.map(fact => [fact.id, new Set([fact.id])]));
  for (const operation of operations) dependencies.set(operation.id,
    new Set(operation.args.flatMap(id => [...dependencies.get(id)])));
  const selectedConditions = ledgers.flatMap(ledger => ledger.claims).filter(claim => claim.relation === 'condition');
  const annotate = value => {
    const conditions = selectedConditions.filter(claim => claim.affectedFacts.some(id => dependencies.get(value.id).has(id)));
    return { ...value, conditional: conditions.length ? true : null, conditions,
      conditionScope: 'Selected conditions propagate; an empty list does not establish unconditionality.' };
  };
  const computed = calculated.results.map(annotate);
  const values = new Map(computed.map(result => [result.id, result]));
  for (const fact of catalog.facts) values.set(fact.id, annotate({ ...fact, sources: [fact.source], derived: false }));
  for (const ledger of ledgers) ledger.values = Object.fromEntries(Object.entries(ledger.values)
    .map(([key, id]) => [key, id === null ? null : values.get(id)]));
  return { budget, deadline, documents: ledgers, operations, computed, sourceFacts: catalog.facts,
    priorAssistantClaimsPresent: messages.some(message => message.role === 'assistant'),
    semanticAcceptance: 'unqualified', scope: 'Calculations and source spans are checked; selected meanings, completeness and final answer remain subject to the unchanged independent factual review.' };
}
