/**
 * @fileoverview Reads research lifecycle form fields into record inputs: comma lists, protocols,
 * candidate costs and uncertainty. Validation and signing stay with the evidence network.
 */

export const commaList = (value) => String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);

export const candidateScientificCostFromForm = (values) => Object.fromEntries([
  ...['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime'].map((component) => [component, {
    amount: values.get(`${component}Amount`),
    unit: values.get(`${component}Unit`),
    burden: values.get(`${component}Burden`)
  }]),
  ['assumptions', commaList(values.get('costAssumptions'))]
]);

export const candidateUncertaintyFromForm = (values) => {
  const representation = values.get('uncertaintyRepresentation');
  const shared = {
    representation,
    rationale: values.get('uncertaintyRationale')
  };
  const represented = representation === 'probability'
    ? {
        ...shared,
        probability: values.get('uncertaintyProbability'),
        calibration: {
          methodId: values.get('calibrationMethodId'),
          version: values.get('calibrationMethodVersion'),
          cohortHash: values.get('calibrationCohortHash'),
          metricId: values.get('calibrationMetricId')
        }
      }
    : representation === 'set_valued'
      ? { ...shared, possibleValues: commaList(values.get('possibleValues')) }
      : {
          ...shared,
          ordinal: {
            level: values.get('ordinalLevel'),
            scaleId: values.get('ordinalScaleId'),
            scaleVersion: values.get('ordinalScaleVersion')
          }
        };
  return values.getAll('uncertaintySources').map((source) => ({ source, ...represented }));
};

export const protocolFromForm = (values) => ({
  protocolId: values.get('protocolId'),
  version: values.get('protocolVersion'),
  assayType: values.get('assayType'),
  executableUri: values.get('executableUri'),
  referenceIdentities: [{ accession: values.get('referenceAccession'), version: values.get('referenceVersion') }],
  conditions: { notes: values.get('conditions') },
  controls: commaList(values.get('controls')),
  readouts: commaList(values.get('readouts')),
  normalization: { method: values.get('normalizationMethod'), version: values.get('normalizationVersion') },
  uncertaintyPlan: values.get('uncertaintyPlan'),
  acceptanceCriteria: values.get('acceptanceCriteria')
});
