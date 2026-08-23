import { describe, expect, it } from 'vitest';

import {
  verifyChangePassportPilotFile,
  verifyChangePassportPilotManifest
} from '../../scripts/verify-change-passport-pilot.js';

describe('Change Passport external pilot gate', () => {
  it('accepts the protocol structure while reporting every external freeze gap', () => {
    const result = verifyChangePassportPilotFile();
    expect(result).toMatchObject({
      valid: true,
      structurallyValid: true,
      frozen: false
    });
    expect(result.unfrozenFields).toContain('adopter');
    expect(result.unfrozenFields).toContain('independentEvaluator');
    expect(result.unfrozenFields).toContain('repository');
  });

  it('fails closed when a release asks for frozen-pilot proof', () => {
    const result = verifyChangePassportPilotFile(undefined, { requireFrozen: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('status must be frozen');
    expect(result.errors).toContain('adopter is not frozen');
  });

  it('rejects a protocol that drops failed cases or the reopening exercise', () => {
    const result = verifyChangePassportPilotManifest({
      schema: 'change.passport-pilot/v1',
      pilotId: 'pilot:invalid',
      status: 'awaiting_external_freeze',
      minimumReportableCases: 20,
      assignmentPolicy: { sameCandidateAndEvidenceCutoff: true, retainEveryAttempt: false },
      successPaths: [{ id: 'quality' }, { id: 'effort' }],
      requiredScenarios: []
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('every attempted case must remain counted');
    expect(result.errors).toContain('a verified reopening scenario is required');
  });
});
