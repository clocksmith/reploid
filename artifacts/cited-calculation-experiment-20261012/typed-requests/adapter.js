import { sourceScopes, calculateScope } from '../source-scoped-selection/scope.js';
import { literalCatalog } from '../lexical-catalog/catalog.js';

const need = (ok, message) => { if (!ok) throw Error(message); };
const exact = (value, keys) => value && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
const LIMITS = Object.freeze({ money: 6, terms: 5, dates: 3, operations: 30 });

/** Only lexical kinds determine admission; no source meaning is inferred. */
export function typedScope(messages, documentId) {
  const scope = sourceScopes(messages).find(item => item.documentId === documentId);
  need(scope, 'Unknown source document');
  const ids = kind => scope.entries.filter(fact => kind.includes(fact.kind)).map(fact => fact.id);
  const reference = values => values.length ? { type: 'string', enum: values } : { not: {} };
  const money = ids(['money']), multipliers = ids(['number', 'percent']);
  const terms = { type: 'array', minItems: 1, maxItems: LIMITS.terms, items: {
    type: 'object', additionalProperties: false, required: ['value', 'sign', 'multiplier'], properties: {
      value: reference(money), sign: { enum: ['add', 'subtract'] },
      multiplier: { anyOf: [{ type: 'null' }, reference(multipliers)] },
    },
  } };
  const schema = [{ type: 'function', function: { name: 'Calculate',
    description: 'Choose source-supported calculations. Money terms sum signed source amounts with optional source number/percent multipliers. First term must add. Dates add a source duration. Results do not establish inclusion, conditions or truth.',
    parameters: { type: 'object', additionalProperties: false, required: ['money', 'dates'], properties: {
      money: { type: 'array', maxItems: LIMITS.money, items: { type: 'object', additionalProperties: false, required: ['terms'], properties: { terms } } },
      dates: { type: 'array', maxItems: LIMITS.dates, items: { type: 'object', additionalProperties: false, required: ['start', 'duration'], properties: {
        start: reference(ids(['date'])), duration: reference(ids(['days', 'weeks'])),
      } } },
    } },
  } }];
  return { ...scope, schema, limits: LIMITS };
}

/** Translate admitted structure, not meaning, to the existing arithmetic owner. */
export function compileRequest(input, messages, documentId) {
  const scope = typedScope(messages, documentId), facts = new Map(scope.entries.map(fact => [fact.id, fact]));
  need(exact(input, ['money', 'dates']), 'Required money/dates arrays only');
  need(Array.isArray(input.money) && input.money.length <= LIMITS.money && Array.isArray(input.dates) && input.dates.length <= LIMITS.dates, 'Request count exceeds bounds');
  const operations = [], outputs = [];
  const get = (id, kinds) => {
    need(typeof id === 'string' && facts.has(id), 'Unknown or out-of-source operand');
    const fact = facts.get(id);
    need(kinds.includes(fact.kind), `Operand ${id} has kind ${fact.kind}; required ${kinds.join('/')}`);
    return fact;
  };
  const emit = (op, args) => {
    need(operations.length < LIMITS.operations, 'Arithmetic operation limit exceeded');
    const id = `calc_${String(operations.length).padStart(3, '0')}`;
    need(!facts.has(id), 'Generated identity collides with source identity');
    operations.push({ id, op, args }); return id;
  };
  for (const [index, request] of input.money.entries()) {
    need(exact(request, ['terms']) && Array.isArray(request.terms) && request.terms.length >= 1 && request.terms.length <= LIMITS.terms, 'Invalid money expression');
    let current;
    for (const [termIndex, term] of request.terms.entries()) {
      need(exact(term, ['value', 'sign', 'multiplier']) && ['add', 'subtract'].includes(term.sign), 'Invalid money term');
      need(termIndex !== 0 || term.sign === 'add', 'First money term must add');
      get(term.value, ['money']); let operand = term.value;
      if (term.multiplier !== null) {
        const factor = get(term.multiplier, ['number', 'percent']);
        operand = emit(factor.kind === 'percent' ? 'percent' : 'multiply', [operand, factor.id]);
      }
      current = termIndex === 0 ? operand : emit(term.sign, [current, operand]);
    }
    outputs.push({ request: `money[${index}]`, id: current });
  }
  for (const [index, request] of input.dates.entries()) {
    need(exact(request, ['start', 'duration']), 'Invalid date expression');
    get(request.start, ['date']); get(request.duration, ['days', 'weeks']);
    outputs.push({ request: `dates[${index}]`, id: emit('addCalendarDuration', [request.start, request.duration]) });
  }
  return { documentId, operations, outputs };
}

export async function calculateRequest(input, messages, documentId) {
  const plan = compileRequest(input, messages, documentId);
  const result = await calculateScope({ operations: plan.operations }, messages, documentId);
  const source = literalCatalog(messages), values = new Map(result.results.map(item => [item.id, item]));
  for (const fact of source.facts) values.set(fact.id, { id: fact.id, kind: fact.kind, value: fact.value, sources: [fact.source], quote: fact.quote, derived: false });
  return { documentId, operations: plan.operations.length,
    results: plan.outputs.map(output => ({ request: output.request, ...values.get(output.id) })),
    intermediateResults: result.results, scope: result.scope };
}

export function typedScopes(messages) {
  return sourceScopes(messages).map(scope => typedScope(messages, scope.documentId));
}
