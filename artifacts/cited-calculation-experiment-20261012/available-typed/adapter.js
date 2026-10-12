import { typedScopes as originalScopes, compileRequest as originalCompile, calculateRequest as originalCalculate } from '../typed-requests/adapter.js';
const need = (ok, message) => { if (!ok) throw Error(message); };

/** Publish only families with source-local operands of their required kinds. */
export function typedScopes(messages) {
  return originalScopes(messages).map(scope => {
    const kinds = new Set(scope.entries.map(fact => fact.kind));
    const families = [];
    if (kinds.has('money')) families.push('money');
    if (kinds.has('date') && (kinds.has('days') || kinds.has('weeks'))) families.push('dates');
    if (families.length === 0) return { ...scope, families, schema: [] };
    const tool = structuredClone(scope.schema[0]);
    tool.function.parameters.required = families;
    tool.function.parameters.properties = Object.fromEntries(families.map(name => [name, tool.function.parameters.properties[name]]));
    // Only announce the selected API; catalog/source clauses remain unchanged.
    tool.function.description = 'Choose source-supported calculations from the available families. '
      + (families.includes('money') ? 'Money terms sum signed source amounts with optional source number/percent multipliers. First term must add. ' : '')
      + (families.includes('dates') ? 'Dates add a source duration. ' : '')
      + 'Results do not establish inclusion, conditions or truth.';
    return { ...scope, families, schema: [tool] };
  });
}

function admittedRequest(input, messages, documentId) {
  const scope = typedScopes(messages).find(item => item.documentId === documentId);
  need(scope && scope.families.length, 'No calculation tool available for this source');
  need(input && !Array.isArray(input) && Object.keys(input).sort().join(',') === [...scope.families].sort().join(','), 'Request fields must equal available operation families');
  for (const family of scope.families) need(Array.isArray(input[family]), 'Declared family requires an array');
  // Omitted API fields are unavailable, not model output to repair. The existing
  // internal calculator contract receives explicit empty arrays for those fields.
  return { money: scope.families.includes('money') ? input.money : [], dates: scope.families.includes('dates') ? input.dates : [] };
}

export function compileRequest(input, messages, documentId) {
  return originalCompile(admittedRequest(input, messages, documentId), messages, documentId);
}

export async function calculateRequest(input, messages, documentId) {
  return originalCalculate(admittedRequest(input, messages, documentId), messages, documentId);
}
