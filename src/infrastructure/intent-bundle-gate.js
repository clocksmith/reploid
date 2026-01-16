/**
 * @fileoverview Intent Bundle Gate
 * Routes intent bundle approvals through HITL and audit logging.
 */

const IntentBundleGate = {
  metadata: {
    id: 'IntentBundleGate',
    version: '1.0.0',
    genesis: { introduced: 'substrate' },
    dependencies: ['Utils', 'VFS', 'HITLController?', 'AuditLogger?', 'EventBus?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, VFS, HITLController, AuditLogger, EventBus } = deps;
    const { logger } = Utils;

    const MODULE_ID = 'IntentBundleGate';
    const CAPABILITY = 'approve_intent_bundle';
    const DEFAULT_BUNDLE_PATH = '/.system/intent-bundle.json';

    const requiredFields = [
      'version',
      'bundleId',
      'createdAt',
      'author',
      'targets',
      'proofs',
      'signatures'
    ];

    const validateBundle = (bundle) => {
      if (!bundle || typeof bundle !== 'object') {
        return { ok: false, errors: ['Intent bundle is not an object'] };
      }
      const missing = requiredFields.filter((field) => !(field in bundle));
      if (missing.length > 0) {
        return { ok: false, errors: [`Missing required fields: ${missing.join(', ')}`] };
      }
      return { ok: true, errors: [] };
    };

    const summarizeBundle = (bundle) => ({
      bundleId: bundle.bundleId,
      version: bundle.version,
      createdAt: bundle.createdAt,
      modelId: bundle.targets?.model?.modelId,
      runtimeHash: bundle.targets?.runtime?.configHash,
      kernelHash: bundle.targets?.kernels?.manifestHash,
      proofCount: Array.isArray(bundle.proofs) ? bundle.proofs.length : 0
    });

    const loadBundle = async (path = DEFAULT_BUNDLE_PATH) => {
      const raw = await VFS.read(path);
      try {
        return JSON.parse(raw);
      } catch (err) {
        const message = err?.message || 'Invalid JSON';
        throw new Error(`Intent bundle parse failed: ${message}`);
      }
    };

    const logAudit = async (type, data, severity = 'INFO') => {
      if (!AuditLogger?.logEvent) return;
      await AuditLogger.logEvent(type, data, severity);
    };

    const requestApproval = async (bundle, options = {}) => {
      const summary = summarizeBundle(bundle);
      const validation = validateBundle(bundle);
      if (!validation.ok) {
        await logAudit('INTENT_BUNDLE_INVALID', { summary, errors: validation.errors }, 'WARN');
        return { approved: false, reason: validation.errors.join('; '), bundle };
      }

      await logAudit('INTENT_BUNDLE_REQUEST', { summary }, 'INFO');
      EventBus?.emit('intent-bundle:requested', { summary });

      if (!HITLController?.requestApproval) {
        await logAudit('INTENT_BUNDLE_APPROVED', { summary, autoApproved: true }, 'INFO');
        EventBus?.emit('intent-bundle:approved', { summary, autoApproved: true });
        return { approved: true, reason: 'Auto-approved', bundle };
      }

      return new Promise((resolve) => {
        HITLController.requestApproval({
          moduleId: MODULE_ID,
          capability: HITLController.CAPABILITIES?.APPROVE_INTENT_BUNDLE || CAPABILITY,
          action: options.action || `Approve intent bundle ${bundle.bundleId}`,
          data: { summary, bundle },
          onApprove: async () => {
            await logAudit('INTENT_BUNDLE_APPROVED', { summary }, 'INFO');
            EventBus?.emit('intent-bundle:approved', { summary });
            resolve({ approved: true, reason: 'Approved', bundle });
          },
          onReject: async (reason) => {
            await logAudit('INTENT_BUNDLE_REJECTED', { summary, reason }, 'WARN');
            EventBus?.emit('intent-bundle:rejected', { summary, reason });
            resolve({ approved: false, reason, bundle });
          },
          timeout: options.timeout || 300000
        });
      });
    };

    const init = () => {
      if (HITLController?.registerModule) {
        HITLController.registerModule(
          MODULE_ID,
          [HITLController.CAPABILITIES?.APPROVE_INTENT_BUNDLE || CAPABILITY],
          'Intent bundle approval gate'
        );
      }
      return true;
    };

    return {
      init,
      loadBundle,
      requestApproval
    };
  }
};

export default IntentBundleGate;
