import configuration from './doppler-execution-contracts.json' with { type: 'json' };

if (configuration?.schema !== 'reploid.doppler-execution-contracts/v1'
  || !configuration.formats || Array.isArray(configuration.formats)
  || !configuration.apis || Array.isArray(configuration.apis)
  || !Object.keys(configuration.formats).length) throw new Error('Invalid Doppler execution contract configuration');

const contracts = Object.freeze(Object.fromEntries(Object.entries(configuration.formats).map(([schema, format]) => {
  const api = configuration.apis[format.api];
  if (!api || typeof format.releaseHistory !== 'boolean'
    || ['openMethod', 'sessionSchema', 'sessionIdentity', 'receiptIdentity', 'requestSchema', 'eventSchema',
      'receiptSchema', 'sequenceReceiptSchema', 'adapterSchema'].some(field => typeof api[field] !== 'string' || !api[field])
    || !Array.isArray(api.identityFields) || api.identityFields.length !== 5
    || api.identityFields.some(field => typeof field !== 'string' || !field)) throw new Error('Invalid Doppler execution contract configuration');
  return [schema, Object.freeze({ ...api, schema, releaseHistory: format.releaseHistory,
    identityFields: Object.freeze([...api.identityFields]) })];
})));

export function resolveDopplerExecutionContract(schema) {
  if (!Object.hasOwn(contracts, schema)) throw new Error('Unsupported executable model schema');
  return contracts[schema];
}
