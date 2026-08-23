/**
 * @fileoverview Explicit external effect and rollback adapter registry.
 */

const text = (value) => String(value || '').trim();

export function createChangeControlEffectRegistry(adapters = {}) {
  const effectAdapters = new Map(Object.entries(adapters.effects || {}));
  const rollbackAdapters = new Map(Object.entries(adapters.rollbacks || {}));
  return {
    registerEffect(kind, adapter) {
      if (!text(kind) || typeof adapter !== 'function') throw new Error('Effect kind and adapter are required');
      effectAdapters.set(text(kind), adapter);
    },
    registerRollback(kind, adapter) {
      if (!text(kind) || typeof adapter !== 'function') throw new Error('Rollback kind and adapter are required');
      rollbackAdapters.set(text(kind), adapter);
    },
    async executeEffect(kind, context) {
      const adapter = effectAdapters.get(text(kind));
      if (!adapter) throw new Error(`No external effect adapter is configured for ${text(kind)}`);
      return adapter(context);
    },
    async executeRollback(kind, context) {
      const adapter = rollbackAdapters.get(text(kind));
      if (!adapter) throw new Error(`No rollback adapter is configured for ${text(kind)}`);
      return adapter(context);
    },
    list() {
      return {
        effects: [...effectAdapters.keys()].sort(),
        rollbacks: [...rollbackAdapters.keys()].sort()
      };
    }
  };
}

export function createGitHubChangeControlAdapters(githubClient) {
  if (!githubClient) return createChangeControlEffectRegistry();
  return createChangeControlEffectRegistry({
    effects: {
      deployment: async ({ projection, request }) => {
        const repository = projection.proposal.repository;
        const deployment = await githubClient.createDeployment({
          installationId: repository.installationId,
          owner: repository.owner,
          repo: repository.name,
          ref: projection.proposal.candidateRevision,
          environment: projection.proposal.target.environment,
          passportId: projection.passportId,
          description: `Reploid Change Passport ${projection.passportId}`,
          idempotencyKey: request.idempotencyKey
        });
        return {
          externalReference: deployment.html_url || deployment.url || `github:deployment:${deployment.id}`,
          providerResult: deployment
        };
      }
    },
    rollbacks: {
      github_revert: async ({ projection, request }) => {
        const repository = projection.proposal.repository;
        const pullRequest = await githubClient.createRollbackPullRequest({
          installationId: repository.installationId,
          owner: repository.owner,
          repo: repository.name,
          baseBranch: repository.defaultBranch,
          rollbackRevision: projection.rollback.revision,
          passportId: projection.passportId,
          rollbackId: request.rollbackId,
          reason: request.reason
        });
        return {
          externalReference: pullRequest.html_url || pullRequest.url || `github:pull:${pullRequest.number}`,
          providerResult: pullRequest
        };
      }
    }
  });
}

export default {
  createChangeControlEffectRegistry,
  createGitHubChangeControlAdapters
};
