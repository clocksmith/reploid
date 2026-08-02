/**
 * @fileoverview Persisted-evidence checks for enabled Poolday model promotion.
 *
 * Catalog admission fields are only pointers. This module verifies the pointed
 * evidence against the exact candidate and baseline contracts before a release
 * verifier may accept an enabled qualified model.
 */

import { validateBrowserQualificationRecord } from './browser-qualification.js';
import { exactModelContractKey } from './model-contract.js';
import { validateScientificFitnessRecord } from './scientific-fitness.js';

const sameContract = (model, identity = {}) => (
  exactModelContractKey(model) === identity.exactModelContractKey
);

export function validateModelPromotionEvidence({
  model = {},
  modelCatalog = [],
  launchModel = null,
  browserQualificationRecord = null,
  scientificFitnessRecord = null
} = {}) {
  const reasons = [];
  const admission = model.admission || {};
  const candidateContractKey = exactModelContractKey(model);

  if (model.sequence?.alphabet === 'nucleotide') {
    const dnaLane = admission.dnaLane || {};
    if (dnaLane.privacy !== 'qualified') reasons.push('DNA promotion requires qualified privacy admission');
    if (dnaLane.referenceCoordinates !== 'qualified') reasons.push('DNA promotion requires qualified reference-coordinate admission');
    if (dnaLane.scientificFitness !== 'qualified') reasons.push('DNA promotion requires qualified DNA scientific-fitness admission');
    if (dnaLane.licensing !== 'approved') reasons.push('DNA promotion requires approved licensing admission');
    if (dnaLane.productUse !== 'admitted') reasons.push('DNA promotion requires admitted product use');
    if (dnaLane.privacy === 'qualified' && !dnaLane.privacyReceipt) {
      reasons.push('DNA promotion requires a persisted privacy admission receipt');
    }
    if (dnaLane.referenceCoordinates === 'qualified' && !dnaLane.referenceCoordinateReceipt) {
      reasons.push('DNA promotion requires a persisted reference-coordinate admission receipt');
    }
    if (dnaLane.scientificFitness === 'qualified' && !dnaLane.scientificFitnessReceipt) {
      reasons.push('DNA promotion requires a persisted DNA scientific-fitness admission receipt');
    }
  }

  if (admission.browserWebGpu === 'qualified') {
    if (!browserQualificationRecord) {
      reasons.push('qualified browser admission is missing its persisted qualification record');
    } else {
      const validation = validateBrowserQualificationRecord(browserQualificationRecord, {
        model,
        exactModelContractKey: candidateContractKey
      });
      reasons.push(...validation.reasons.map((reason) => `browser qualification: ${reason}`));
    }
  }

  if (admission.scientificFitness === 'qualified') {
    if (!scientificFitnessRecord) {
      reasons.push('qualified scientific admission is missing its persisted fitness record');
    } else {
      const declaredBaselines = Array.isArray(scientificFitnessRecord.baselines)
        ? scientificFitnessRecord.baselines
        : [];
      const baselines = [];
      for (const identity of declaredBaselines) {
        const baseline = modelCatalog.find((entry) => sameContract(entry, identity));
        if (!baseline) {
          reasons.push('scientific fitness references a baseline absent from the governed model catalog');
          continue;
        }
        if (baseline.enabled === false) {
          reasons.push('scientific fitness baseline is not enabled for release comparison');
        }
        baselines.push(baseline);
      }
      if (!launchModel || !baselines.some((baseline) => sameContract(baseline, {
        exactModelContractKey: exactModelContractKey(launchModel)
      }))) {
        reasons.push('scientific fitness must include the enabled ESM-2 baseline contract');
      }
      const validation = validateScientificFitnessRecord(scientificFitnessRecord, {
        candidate: model,
        candidateContractKey,
        baselines,
        baselineContractKeys: baselines.map((baseline) => exactModelContractKey(baseline))
      });
      reasons.push(...validation.reasons.map((reason) => `scientific fitness: ${reason}`));
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export default {
  validateModelPromotionEvidence
};
