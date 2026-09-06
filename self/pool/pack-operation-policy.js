/** Pure configuration validation. No execution, networking, or inferred policy. */
const assert = (ok, message) => { if (!ok) throw new Error(`Pack operation policy: ${message}`); };
const identifier = value => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(value);
const strings = value => Array.isArray(value) && value.every(identifier) && new Set(value).size === value.length;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fieldTypes = Object.freeze({ 'positive-integer': positive, 'finite-number': Number.isFinite,
  boolean: value => typeof value === 'boolean' });

export function freezeOperationPolicy(value, depth = 0) {
  assert(depth <= 64, 'configuration depth exceeded');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number') { assert(Number.isFinite(value), 'non-finite configuration'); return value; }
  assert(object(value) || Array.isArray(value), 'JSON configuration required');
  assert(Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'plain configuration required');
  return Object.freeze(Array.isArray(value) ? value.map(child => freezeOperationPolicy(child, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, freezeOperationPolicy(child, depth + 1)])));
}

export function resolvePackOperationDefinitions(definitions, comparisons) {
  const resolved = freezeOperationPolicy(definitions), rules = freezeOperationPolicy(comparisons);
  assert(object(resolved) && Object.keys(resolved).length > 0 && object(rules), 'operation definitions and comparison policies required');
  for (const [id, rule] of Object.entries(rules)) {
    assert(identifier(id) && object(rule) && strings(rule.requiredFields) && strings(rule.nonnegativeFields)
      && rule.nonnegativeFields.every(field => rule.requiredFields.includes(field)), `invalid comparison policy ${id}`);
  }
  for (const [id, definition] of Object.entries(resolved)) {
    assert(identifier(id) && definition.schema === 'reploid.pool.operation-definition/v1'
      && positive(definition.version) && identifier(definition.adapterId) && identifier(definition.workload), `invalid definition ${id}`);
    assert(definition.dopplerOperation?.name === id && definition.dopplerOperation.version === definition.version,
      `${id}: operation aliases require an explicit Doppler contract; implicit renaming forbidden`);
    for (const name of ['inputContract', 'optionsContract']) {
      const contract = definition[name];
      assert(positive(contract?.version) && strings(contract.allowedFields) && strings(contract.requiredFields)
        && contract.requiredFields.every(field => contract.allowedFields.includes(field)), `${id}: invalid ${name}`);
      assert(object(contract.fieldTypes) && Object.entries(contract.fieldTypes).every(([field, type]) => contract.allowedFields.includes(field)
        && Object.hasOwn(fieldTypes, type)), `${id}: unknown field type`);
    }
    assert(positive(definition.outputContract?.version) && typeof definition.streaming?.partial === 'boolean', `${id}: output and streaming contracts required`);
    for (const field of ['maxInputBytes', 'maxOutputBytes', 'maxStreamBytes', 'maxEvents', 'maxJobMs']) {
      assert(positive(definition.maximumLimits?.[field]), `${id}: maximumLimits.${field} required`);
    }
    assert(strings(definition.comparisonPolicyIds) && definition.comparisonPolicyIds.length > 0
      && definition.comparisonPolicyIds.every(policyId => Object.hasOwn(rules, policyId)), `${id}: unknown comparison policy`);
    assert(strings(definition.inputClasses?.local) && definition.inputClasses.local.length > 0 && strings(definition.inputClasses.remote)
      && definition.inputClasses.remote.every(value => definition.inputClasses.local.includes(value)), `${id}: explicit input classes required`);
    assert(definition.inputClasses.defaultRemote === null || definition.inputClasses.remote.includes(definition.inputClasses.defaultRemote), `${id}: explicit remote input class or null required`);
  }
  return Object.freeze({ definitions: resolved, comparisons: rules });
}

export function assertOperationFields(value, contract, name) {
  assert(object(value) && Object.keys(value).every(field => contract.allowedFields.includes(field)), `${name}: unexpected input or option fields`);
  for (const field of contract.requiredFields) assert(Object.hasOwn(value, field), `${name}.${field} required`);
  for (const [field, type] of Object.entries(contract.fieldTypes)) {
    if (Object.hasOwn(value, field)) assert(fieldTypes[type](value[field]), `${name}.${field}: ${type} required`);
  }
}

export function assertOperationLimits(limits, definition) {
  for (const [field, maximum] of Object.entries(definition.maximumLimits)) {
    if (Object.hasOwn(limits, field)) assert(positive(limits[field]) && limits[field] <= maximum, `${field} exceeds configured operation limit`);
  }
}
