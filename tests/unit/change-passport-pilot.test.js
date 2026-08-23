import { describe, expect, it } from 'vitest';

import {
  verifyChangePassportPilotFile,
  verifyChangePassportPilotManifest
} from '../../scripts/verify-change-passport-pilot.js';

describe('Agent Release Passport external pilot gate', () => {
  it('accepts the narrow protocol structure while reporting external freeze gaps', () => {
    const result = verifyChangePassportPilotFile();
    expect(result).toMatchObject({ valid: true, structurallyValid: true, frozen: false });
    expect(result.unfrozenFields).toContain('adopter.organizationId');
    expect(result.unfrozenFields).toContain('independentEvaluator.authorityId');
    expect(result.unfrozenFields).toContain('repository.fullName');
    expect(result.unfrozenFields).toContain('agentProgram.programId');
  });

  it('fails closed when an unfrozen template asks for pilot proof', () => {
    const result = verifyChangePassportPilotFile(undefined, { requireFrozen: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('status must be frozen');
    expect(result.errors).toContain('adopter.organizationId is not frozen');
    expect(result.errors).toContain('GitHub App is not externally installable');
  });

  it('rejects generic changes, dropped failures, broad App authority, and missing reopening', () => {
    const result = verifyChangePassportPilotManifest({
      schema: 'reploid.agent-release-passport-pilot/v1',
      pilotId: 'pilot:invalid',
      status: 'awaiting_external_freeze',
      minimumReportableCases: 20,
      product: { supportedChangeClasses: ['generic_source_patch'] },
      changeClass: 'generic_source_patch',
      githubApp: {
        permissions: { checks: 'write', metadata: 'read', pullRequests: 'write', contents: 'write' },
        events: ['push'],
        prohibitedPermissions: []
      },
      assignmentPolicy: { sameCandidateAndEvidenceCutoff: true, retainEveryAttempt: false },
      successPaths: [{ id: 'quality' }, { id: 'effort' }],
      requiredScenarios: []
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('changeClass is outside the Agent Release Passport wedge');
    expect(result.errors).toContain('every attempted case must remain counted');
    expect(result.errors).toContain('GitHub App permissions must match the check-only contract');
    expect(result.errors).toContain('reopening and changed-candidate scenarios are required');
  });

  it('rejects malformed digests, budgets, and collapsed authorities', () => {
    const result = verifyChangePassportPilotManifest({
      schema: 'reploid.agent-release-passport-pilot/v1',
      pilotId: 'pilot:invalid-boundaries',
      status: 'awaiting_external_freeze',
      minimumReportableCases: 20,
      product: { supportedChangeClasses: ['mcp_server_version', 'agent_tool_manifest', 'agent_permission_policy', 'production_agent_configuration'] },
      operator: { authorityId: 'authority:same' },
      independentEvaluator: { authorityId: 'authority:same' },
      candidate: { baselineDigest: 'not-a-hash' },
      baselineWorkflow: { resourceBudget: { caseCount: 0, maximumOperatorMinutes: 0, maximumElapsedMilliseconds: 0 } },
      githubApp: {
        permissions: { checks: 'write', metadata: 'read', pullRequests: 'read' },
        events: ['pull_request', 'pull_request_review'],
        prohibitedPermissions: ['contents', 'deployments', 'administration', 'workflows', 'secrets']
      },
      assignmentPolicy: { sameCandidateAndEvidenceCutoff: true, retainEveryAttempt: true },
      successPaths: [{ id: 'quality' }, { id: 'effort' }],
      requiredScenarios: ['verified_reopening', 'candidate_changed_after_freeze'],
      reopening: { rules: [] }
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('operator, evaluator, and approving authority must be distinct');
    expect(result.errors).toContain('candidate.baselineDigest must be a SHA-256 digest');
    expect(result.errors).toContain('resource budget must bind positive case, operator-minute, and elapsed-time limits');
  });
});
