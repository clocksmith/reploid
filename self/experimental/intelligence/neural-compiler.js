/**
 * @fileoverview Neural Compiler
 * Routes tasks to LoRA adapters and batches execution to minimize swaps.
 */

export const TRAINED_ADAPTER_ADMISSION_SCHEMA = 'reploid.trained-adapter-admission/v2';
export const TRAINED_ADAPTER_HUMAN_APPROVAL_SCHEMA = 'reploid.trained-adapter-human-approval/v1';
export const PROMOTION_VERIFICATION_SCHEMA = 'clocksmith.promotion-verification/v1';
export const EXPOSURE_LEDGER_SCHEMA_SHA256 = '5262a2ed29dd97d163c49f21ab69b54103dc524c68959dc0561defb128fdc038';

const TRAINER_PROFILES = Object.freeze({
  'thinking-machines/tinker': 'tinker_peft_browser_adapter',
  'clocksmith/doppler': 'doppler_peft_browser_adapter'
});

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

const stableJson = (value) => {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    const token = Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity';
    return stableJson({ $number: token });
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
};

const requireText = (value, field) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Trained adapter admission requires ${field}`);
  return text;
};

const requireSha256 = (value, field) => {
  const digest = requireText(value, field).replace(/^sha256:/, '').toLowerCase();
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`Trained adapter admission requires a SHA-256 digest at ${field}`);
  }
  return digest;
};

const sha256Text = async (value, cryptoApi = globalThis.crypto) => {
  if (!cryptoApi?.subtle) throw new Error('Trained adapter admission requires WebCrypto');
  const bytes = new TextEncoder().encode(value);
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const findNonfinite = (value, path = '$', findings = []) => {
  if (typeof value === 'number' && !Number.isFinite(value)) findings.push(path);
  else if (Array.isArray(value)) value.forEach((entry, index) => findNonfinite(entry, `${path}[${index}]`, findings));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, entry]) => findNonfinite(entry, `${path}.${key}`, findings));
  }
  return findings;
};

const verifyReceiptHash = async (receipt, hashField, field, cryptoApi) => {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`Trained adapter admission requires ${field}`);
  }
  const nonfinite = findNonfinite(receipt);
  if (nonfinite.length) {
    throw new Error(`Trained adapter admission rejected ${field}: nonfinite evidence at ${nonfinite.join(', ')}`);
  }
  const expected = requireSha256(receipt[hashField], `${field}.${hashField}`);
  const core = { ...receipt };
  delete core[hashField];
  const observed = await sha256Text(stableJson(core), cryptoApi);
  if (observed !== expected) {
    throw new Error(`Trained adapter admission rejected ${field}: receipt hash mismatch`);
  }
  return expected;
};

const manifestTrainer = (manifest) => (
  manifest?.trainer
  || manifest?.provenance?.trainer
  || manifest?.training?.provider
  || ''
);

const manifestBaseModelId = (manifest) => (
  typeof manifest?.baseModel === 'string'
    ? manifest.baseModel
    : manifest?.baseModel?.id || manifest?.baseModel?.modelId || ''
);

const manifestBaseCheckpointSha256 = (manifest) => (
  manifest?.baseCheckpointSha256 || manifest?.baseModel?.checkpointSha256 || ''
);

const manifestAdapterSha256 = (manifest) => (
  manifest?.adapterSha256 || manifest?.integrity?.sha256 || ''
);

const isGovernedTrainedAdapter = (manifest, entry = null) => (
  entry?.metadata?.trainedAdapter === true
  || Object.hasOwn(TRAINER_PROFILES, manifestTrainer(manifest))
);

export async function verifyTrainedAdapterAdmission(admission, manifest, cryptoApi = globalThis.crypto) {
  if (!admission || admission.schema !== TRAINED_ADAPTER_ADMISSION_SCHEMA) {
    throw new Error(`Trained adapter admission schema must be ${TRAINED_ADAPTER_ADMISSION_SCHEMA}`);
  }
  if (admission.state !== 'shadow') {
    throw new Error('Trained adapter admission state must be shadow');
  }
  const trainer = manifestTrainer(manifest);
  const parityProfile = TRAINER_PROFILES[trainer];
  if (!parityProfile) {
    throw new Error('Trained adapter manifest trainer must be an approved Tinker or Doppler trainer');
  }

  const identity = admission.dopplerIdentityReceipt;
  const parity = admission.dopplerParityReceipt;
  const gamma = admission.gammaSelectionReceipt;
  const promotionVerification = admission.promotionVerification;
  const identityReceiptHash = await verifyReceiptHash(
    identity,
    'receiptHash',
    'dopplerIdentityReceipt',
    cryptoApi
  );
  const parityReceiptHash = await verifyReceiptHash(
    parity,
    'receiptHash',
    'dopplerParityReceipt',
    cryptoApi
  );
  const gammaReceiptHash = await verifyReceiptHash(
    gamma,
    'receiptSha256',
    'gammaSelectionReceipt',
    cryptoApi
  );
  const promotionVerificationReceiptHash = await verifyReceiptHash(
    promotionVerification,
    'receiptHash',
    'promotionVerification',
    cryptoApi
  );

  if (identity.schema !== 'doppler.trainer-artifact-handoff-verification/v1'
    || identity.ok !== true
    || identity.artifactKind !== 'peft_adapter'
    || identity.artifactRole !== 'selected_candidate'
    || identity.selection?.authority !== 'clocksmith/gamma'
    || identity.selection?.status !== 'selected'
    || identity.admission?.candidateCompetitionAllowed !== true
    || identity.admission?.promotionAllowed !== false) {
    throw new Error('Trained adapter admission rejected the Doppler identity decision');
  }
  if (parity.schema !== 'doppler.trainer-artifact-parity-receipt/v1'
    || parity.profile !== parityProfile
    || parity.decision !== 'pass'
    || parity.bridgeId !== identity.bridgeId
    || parity.identityReceiptHash !== identityReceiptHash
    || parity.artifactIdentitySha256 !== identity.artifactIdentitySha256) {
    throw new Error('Trained adapter admission rejected the Doppler parity decision');
  }
  if (gamma.schema !== 'gamma.tinker-browser-selection-receipt/v1'
    || gamma.decision !== 'gamma_selected'
    || gamma.admission?.candidateCompetitionAllowed !== true
    || gamma.admission?.promotionAllowed !== false
    || gamma.task?.passed !== true
    || gamma.retention?.passed !== true) {
    throw new Error('Trained adapter admission rejected the Gamma selection decision');
  }
  for (const [levelId, level] of Object.entries(gamma.determinism || {})) {
    if (level?.required === true && level.passed !== true) {
      throw new Error(`Trained adapter admission rejected required determinism level ${levelId}`);
    }
  }
  if (gamma.evidence?.dopplerIdentity?.receiptSha256 !== identityReceiptHash
    || gamma.evidence?.dopplerParity?.receiptSha256 !== parityReceiptHash) {
    throw new Error('Trained adapter admission rejected Gamma to Doppler receipt binding');
  }

  const adapterId = requireText(gamma.artifact?.adapterId, 'gammaSelectionReceipt.artifact.adapterId');
  const adapterSha256 = requireSha256(
    gamma.artifact?.adapterSha256,
    'gammaSelectionReceipt.artifact.adapterSha256'
  );
  const baseModelId = requireText(
    gamma.artifact?.baseModelId,
    'gammaSelectionReceipt.artifact.baseModelId'
  );
  const baseCheckpointSha256 = requireSha256(
    gamma.artifact?.baseCheckpointSha256,
    'gammaSelectionReceipt.artifact.baseCheckpointSha256'
  );
  if ((manifest.id || manifest.name) !== adapterId
    || gamma.artifact?.trainer !== trainer
    || requireSha256(manifestAdapterSha256(manifest), 'manifest.adapterSha256') !== adapterSha256
    || manifestBaseModelId(manifest) !== baseModelId
    || requireSha256(
      manifestBaseCheckpointSha256(manifest),
      'manifest.baseCheckpointSha256'
    ) !== baseCheckpointSha256) {
    throw new Error('Trained adapter admission rejected manifest and Gamma artifact identity mismatch');
  }
  if (promotionVerification.schema !== PROMOTION_VERIFICATION_SCHEMA
    || promotionVerification.ok !== true
    || promotionVerification.decision !== 'promotion_eligible'
    || promotionVerification.campaignState !== 'confirmed'
    || promotionVerification.reasons?.length !== 0
    || requireSha256(
      promotionVerification.exposureLedgerSchemaSha256,
      'promotionVerification.exposureLedgerSchemaSha256'
    ) !== EXPOSURE_LEDGER_SCHEMA_SHA256
    || promotionVerification.candidate?.id !== adapterId
    || requireSha256(
      promotionVerification.candidate?.sha256,
      'promotionVerification.candidate.sha256'
    ) !== adapterSha256) {
    throw new Error('Trained adapter admission rejected independent promotion verification');
  }

  return {
    schema: TRAINED_ADAPTER_ADMISSION_SCHEMA,
    state: 'shadow',
    artifact: { adapterId, adapterSha256, baseModelId, baseCheckpointSha256, trainer },
    receipts: {
      identityReceiptHash,
      parityReceiptHash,
      gammaReceiptHash,
      promotionVerificationReceiptHash
    },
    evidence: { identity, parity, gamma, promotionVerification }
  };
}

const verifyHumanApproval = async (entry, cryptoApi = globalThis.crypto) => {
  const approval = entry?.metadata?.humanApproval;
  if (!approval || approval.schema !== TRAINED_ADAPTER_HUMAN_APPROVAL_SCHEMA) {
    throw new Error('Trained adapter activation requires a human approval receipt');
  }
  const receiptSha256 = await verifyReceiptHash(
    approval,
    'receiptSha256',
    'humanApproval',
    cryptoApi
  );
  const artifact = entry.metadata.trainedAdapterAdmission?.artifact;
  const receipts = entry.metadata.trainedAdapterAdmission?.receipts;
  if (approval.decision !== 'approve'
    || approval.source !== 'hitl-controller'
    || approval.humanRequired !== true
    || approval.adapterId !== artifact?.adapterId
    || approval.adapterSha256 !== artifact?.adapterSha256
    || approval.dopplerIdentityReceiptHash !== receipts?.identityReceiptHash
    || approval.dopplerParityReceiptHash !== receipts?.parityReceiptHash
    || approval.gammaSelectionReceiptHash !== receipts?.gammaReceiptHash
    || approval.promotionVerificationReceiptHash !== receipts?.promotionVerificationReceiptHash) {
    throw new Error('Trained adapter activation rejected human approval binding');
  }
  return receiptSha256;
};

const NeuralCompiler = {
  metadata: {
    id: 'NeuralCompiler',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus?', 'VFS', 'LLMClient', 'DopplerToolbox?', 'SemanticMemory', 'IntentBundleGate?', 'HITLController?'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const {
      Utils,
      EventBus,
      VFS,
      LLMClient,
      DopplerToolbox,
      SemanticMemory,
      IntentBundleGate,
      HITLController
    } = deps;
    const { logger, Errors, generateId } = Utils;

    const REGISTRY_PATH = '/.memory/neural-compiler/adapters.json';
    const DEFAULT_BUNDLE_PATH = '/.system/intent-bundle.json';
    const DEFAULT_MANIFEST_DIR = '/config/lora-adapters';

    const _registry = new Map();
    let _activeAdapter = null;
    let _stats = { swaps: 0, tasks: 0 };

    const emit = (event, payload) => {
      if (EventBus) {
        EventBus.emit(event, payload);
      }
    };

    const cosineSimilarity = (a, b) => {
      if (!a || !b || a.length !== b.length) return 0;
      let dot = 0;
      let normA = 0;
      let normB = 0;
      for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
      }
      const denom = Math.sqrt(normA) * Math.sqrt(normB);
      return denom === 0 ? 0 : dot / denom;
    };

    const normalizePath = (path) => {
      if (!path || typeof path !== 'string') return null;
      return path.startsWith('/') ? path : `/${path}`;
    };

    const loadBundle = async (path = DEFAULT_BUNDLE_PATH) => {
      if (IntentBundleGate?.loadBundle) {
        return IntentBundleGate.loadBundle(path);
      }

      const raw = await VFS.read(path);
      try {
        return JSON.parse(raw);
      } catch (err) {
        throw new Errors.ValidationError(`Intent bundle parse failed: ${err?.message || 'invalid JSON'}`);
      }
    };

    const requestApproval = async (bundle, options = {}) => {
      if (IntentBundleGate?.requestApproval) {
        return IntentBundleGate.requestApproval(bundle, options);
      }
      return { approved: true, reason: 'IntentBundleGate not available', bundle };
    };

    const resolveAdapterRef = (bundle) => {
      const payload = bundle?.payload || {};
      const loraTarget = bundle?.targets?.loras?.[0] || null;
      return payload.loraAdapterManifest || payload.loraAdapter || loraTarget?.loraId || null;
    };

    const resolveManifestPath = (bundle) => {
      const ref = resolveAdapterRef(bundle);
      if (!ref) {
        return { path: null, reason: 'No LoRA adapter reference found' };
      }

      if (ref.endsWith('.json')) {
        return { path: normalizePath(ref), reason: null };
      }

      if (ref.includes('/')) {
        return { path: null, reason: 'LoRA reference does not point to a manifest' };
      }

      return { path: `${DEFAULT_MANIFEST_DIR}/${ref}.json`, reason: null };
    };

    const loadManifest = async (manifestPath) => {
      if (!manifestPath) return null;
      try {
        const raw = await VFS.read(manifestPath);
        return JSON.parse(raw);
      } catch (err) {
        logger.warn('[NeuralCompiler] Intent bundle manifest load failed:', err?.message || err);
        return null;
      }
    };

    const verifyAssets = async (manifest, options = {}) => {
      if (!options.verifyAssets) {
        return { ok: true, missing: [] };
      }

      const shards = Array.isArray(manifest?.shards) ? manifest.shards : [];
      if (shards.length === 0 || typeof VFS.exists !== 'function') {
        return { ok: true, missing: [] };
      }

      const missing = [];
      for (const shard of shards) {
        const shardPath = shard?.path;
        if (!shardPath) continue;
        const exists = await VFS.exists(shardPath);
        if (!exists) missing.push(shardPath);
      }

      return { ok: missing.length === 0, missing };
    };

    const persistRegistry = async () => {
      if (!VFS) return;
      const data = Array.from(_registry.values());
      await VFS.write(REGISTRY_PATH, JSON.stringify({ adapters: data }, null, 2));
    };

    const loadRegistry = async () => {
      if (!VFS) return;
      try {
        const content = await VFS.read(REGISTRY_PATH);
        const data = JSON.parse(content || '{}');
        _registry.clear();
        for (const entry of data.adapters || []) {
          _registry.set(entry.name, entry);
        }
      } catch (err) {
        if (!String(err?.message || '').includes('not found')) {
          logger.warn('[NeuralCompiler] Failed to load registry:', err.message);
        }
      }
    };

    const init = async () => {
      await loadRegistry();
      if (HITLController?.registerModule) {
        HITLController.registerModule(
          'NeuralCompiler',
          [HITLController.CAPABILITIES?.APPROVE_TRAINED_ADAPTER || 'approve_trained_adapter'],
          'Human promotion of evidence-qualified trained adapters'
        );
      }
      logger.info('[NeuralCompiler] Initialized');
      return true;
    };

    const registerAdapter = async (name, manifestPath, options = {}) => {
      if (!name) {
        throw new Errors.ValidationError('Adapter name required');
      }
      if (!manifestPath && !options.manifest) {
        throw new Errors.ValidationError('Adapter manifest path or manifest required');
      }

      let embedding = options.embedding;
      const routingText = options.routingText || options.keywords?.join(' ') || name;
      if (!embedding && SemanticMemory) {
        embedding = await SemanticMemory.embed(routingText);
      }

      const entry = {
        name,
        manifestPath: manifestPath || null,
        manifest: options.manifest || null,
        embedding: embedding || null,
        metadata: options.metadata || {},
        routingText,
        updatedAt: Date.now()
      };

      _registry.set(name, entry);
      await persistRegistry();

      emit('neural-compiler:adapter-registered', { name });
      return entry;
    };

    const stageTrainedAdapter = async (manifestPath, admission, options = {}) => {
      if (!manifestPath && !options.manifest) {
        throw new Errors.ValidationError('Trained adapter manifest path or manifest required');
      }
      const manifest = options.manifest || JSON.parse(await VFS.read(manifestPath));
      let verified;
      try {
        verified = await verifyTrainedAdapterAdmission(admission, manifest);
      } catch (error) {
        throw new Errors.ValidationError(error?.message || String(error));
      }
      const name = verified.artifact.adapterId;
      const routingText = options.routingText || name;
      const embedding = options.embedding
        || (SemanticMemory ? await SemanticMemory.embed(routingText) : null);
      const entry = {
        name,
        manifestPath: manifestPath || null,
        manifest,
        embedding,
        metadata: {
          ...(options.metadata || {}),
          trainedAdapter: true,
          admissionState: 'shadow',
          trainedAdapterAdmission: verified,
          humanApproval: null
        },
        routingText,
        updatedAt: Date.now()
      };
      _registry.set(name, entry);
      await persistRegistry();
      emit('neural-compiler:trained-adapter-staged', {
        name,
        adapterSha256: verified.artifact.adapterSha256
      });
      return entry;
    };

    const promoteTrainedAdapter = async (name) => {
      const entry = _registry.get(name);
      if (!entry?.metadata?.trainedAdapter || entry.metadata.admissionState !== 'shadow') {
        throw new Errors.ValidationError(`Trained adapter is not staged in Shadow: ${name}`);
      }
      if (!HITLController?.requestApproval) {
        throw new Errors.ConfigError('Trained adapter promotion requires HITLController');
      }
      const admission = entry.metadata.trainedAdapterAdmission;
      return new Promise((resolve, reject) => {
        const approvalId = HITLController.requestApproval({
          moduleId: 'NeuralCompiler',
          capability: HITLController.CAPABILITIES?.APPROVE_TRAINED_ADAPTER
            || 'approve_trained_adapter',
          action: `Promote trained adapter ${name}`,
          data: {
            adapterId: name,
            adapterSha256: admission.artifact.adapterSha256,
            baseModelId: admission.artifact.baseModelId,
            gammaSelectionReceiptHash: admission.receipts.gammaReceiptHash,
            promotionVerificationReceiptHash: admission.receipts.promotionVerificationReceiptHash
          },
          alwaysRequireHuman: true,
          onApprove: async (_data, context) => {
            try {
              if (context?.source !== 'hitl-controller' || context?.humanRequired !== true) {
                throw new Error('Trained adapter promotion requires HITL human approval context');
              }
              const core = {
                schema: TRAINED_ADAPTER_HUMAN_APPROVAL_SCHEMA,
                approvalId: requireText(context.approvalId, 'humanApproval.approvalId'),
                approvedAt: new Date(context.approvedAt).toISOString(),
                source: context.source,
                humanRequired: true,
                decision: 'approve',
                adapterId: admission.artifact.adapterId,
                adapterSha256: admission.artifact.adapterSha256,
                dopplerIdentityReceiptHash: admission.receipts.identityReceiptHash,
                dopplerParityReceiptHash: admission.receipts.parityReceiptHash,
                gammaSelectionReceiptHash: admission.receipts.gammaReceiptHash,
                promotionVerificationReceiptHash: admission.receipts.promotionVerificationReceiptHash
              };
              entry.metadata.admissionState = 'promoted';
              entry.metadata.humanApproval = {
                ...core,
                receiptSha256: await sha256Text(stableJson(core))
              };
              entry.updatedAt = Date.now();
              await persistRegistry();
              emit('neural-compiler:trained-adapter-promoted', {
                name,
                humanApprovalReceiptHash: entry.metadata.humanApproval.receiptSha256
              });
              resolve({ status: 'promoted', name, humanApproval: entry.metadata.humanApproval });
            } catch (error) {
              reject(error);
            }
          },
          onReject: (reason) => {
            emit('neural-compiler:trained-adapter-rejected', { name, reason });
            resolve({ status: 'rejected', name, reason });
          }
        });
        if (!approvalId) {
          reject(new Errors.ConfigError('Trained adapter promotion was not queued for a human'));
        }
      });
    };

    const unregisterAdapter = async (name) => {
      if (!_registry.has(name)) return false;
      _registry.delete(name);
      await persistRegistry();
      emit('neural-compiler:adapter-removed', { name });
      return true;
    };

    const listAdapters = () => Array.from(_registry.values());

    const findNearestAdapter = (embedding) => {
      let best = { name: null, score: 0 };
      for (const entry of _registry.values()) {
        if (!entry.embedding) continue;
        const score = cosineSimilarity(embedding, entry.embedding);
        if (score > best.score) {
          best = { name: entry.name, score };
        }
      }
      return best;
    };

    const resolveAdapterForTask = async (task) => {
      if (task.adapter) return { name: task.adapter, score: 1 };
      const text = task.routingText || task.description || task.prompt || '';
      if (!text) return { name: null, score: 0 };
      if (!SemanticMemory) return { name: null, score: 0 };
      const embedding = await SemanticMemory.embed(text);
      return findNearestAdapter(embedding);
    };

    const loadAdapter = async (name) => {
      if (!name) {
        const unload = DopplerToolbox?.unloadLoRAAdapter || LLMClient?.unloadLoRAAdapter;
        if (unload) {
          await unload();
        }
        _activeAdapter = null;
        return null;
      }

      if (_activeAdapter === name) return name;

      const entry = _registry.get(name);
      if (!entry) {
        throw new Errors.ValidationError(`Adapter not registered: ${name}`);
      }

      const manifest = entry.manifest
        ? entry.manifest
        : entry.manifestPath
          ? JSON.parse(await VFS.read(entry.manifestPath))
          : null;

      if (!manifest) {
        throw new Errors.ValidationError(`Adapter manifest missing for ${name}`);
      }

      if (isGovernedTrainedAdapter(manifest, entry)) {
        if (entry.metadata?.admissionState !== 'promoted') {
          throw new Errors.ValidationError(`Trained adapter is not human-promoted: ${name}`);
        }
        try {
          await verifyHumanApproval(entry);
        } catch (error) {
          throw new Errors.ValidationError(error?.message || String(error));
        }
      }

      const load = DopplerToolbox?.loadLoRAAdapter || LLMClient?.loadLoRAAdapter;
      if (!load) {
        throw new Errors.ConfigError('LoRA adapter loading requires DopplerToolbox or LLMClient support');
      }
      await load(manifest);
      _activeAdapter = name;
      _stats.swaps += 1;
      emit('neural-compiler:adapter-loaded', { name });
      return name;
    };

    const getActiveAdapter = () => _activeAdapter;

    const deriveAdapterName = (bundle, manifest) => {
      if (manifest?.name) return manifest.name;
      const ref = resolveAdapterRef(bundle);
      if (!ref) return 'intent-bundle-adapter';
      const tail = ref.split('/').pop() || ref;
      return tail.endsWith('.json') ? tail.slice(0, -5) : tail;
    };

    const applyIntentBundle = async (bundleOrPath = DEFAULT_BUNDLE_PATH, options = {}) => {
      const bundle = typeof bundleOrPath === 'string'
        ? await loadBundle(bundleOrPath)
        : bundleOrPath;

      if (!bundle) {
        throw new Errors.ValidationError('Intent bundle required');
      }

      const approval = await requestApproval(bundle, options);
      if (!approval.approved) {
        emit('intent-bundle:lora:rejected', {
          bundleId: bundle.bundleId || null,
          reason: approval.reason || 'rejected'
        });
        return {
          status: 'rejected',
          approved: false,
          reason: approval.reason || 'rejected',
          bundleId: bundle.bundleId || null
        };
      }

      const { path: manifestPath, reason } = resolveManifestPath(bundle);
      if (!manifestPath) {
        emit('intent-bundle:lora:missing', {
          bundleId: bundle.bundleId || null,
          reason
        });
        return {
          status: 'missing_assets',
          approved: true,
          stub: true,
          reason,
          bundleId: bundle.bundleId || null
        };
      }

      const manifest = await loadManifest(manifestPath);
      if (!manifest) {
        emit('intent-bundle:lora:missing', {
          bundleId: bundle.bundleId || null,
          reason: 'Manifest missing',
          manifestPath
        });
        return {
          status: 'missing_assets',
          approved: true,
          stub: true,
          reason: 'Manifest missing',
          manifestPath,
          bundleId: bundle.bundleId || null
        };
      }

      const assetCheck = await verifyAssets(manifest, options);
      if (!assetCheck.ok) {
        const missing = assetCheck.missing || [];
        emit('intent-bundle:lora:missing', {
          bundleId: bundle.bundleId || null,
          reason: 'LoRA shards missing',
          missing,
          manifestPath
        });
        return {
          status: 'missing_assets',
          approved: true,
          stub: true,
          reason: 'LoRA shards missing',
          missing,
          manifestPath,
          bundleId: bundle.bundleId || null
        };
      }

      const adapterName = deriveAdapterName(bundle, manifest);
      let registered = null;
      if (options.registerAdapter !== false) {
        const metadata = {
          source: 'intent-bundle',
          bundleId: bundle.bundleId || null,
          baseModel: manifest.baseModel || bundle?.targets?.model?.modelId || null
        };
        const routingText = options.routingText || bundle?.payload?.instructions || adapterName;
        registered = await registerAdapter(adapterName, manifestPath, {
          manifest,
          metadata,
          routingText
        });
      }

      try {
        await loadAdapter(adapterName);
      } catch (err) {
        logger.warn('[NeuralCompiler] Intent bundle LoRA load failed:', err?.message || err);
        emit('intent-bundle:lora:error', {
          bundleId: bundle.bundleId || null,
          error: err?.message || String(err)
        });
        return {
          status: 'failed',
          approved: true,
          error: err?.message || String(err),
          manifestPath,
          bundleId: bundle.bundleId || null
        };
      }

      const result = {
        status: 'loaded',
        approved: true,
        adapter: _activeAdapter,
        manifestPath,
        bundleId: bundle.bundleId || null,
        registered: !!registered
      };

      emit('intent-bundle:lora:loaded', result);
      return result;
    };

    const executeTask = async (task, options = {}) => {
      if (!task) {
        throw new Errors.ValidationError('Task required');
      }

      const modelConfig = task.model || options.model;
      if (!modelConfig) {
        throw new Errors.ValidationError('Model config required');
      }

      const target = await resolveAdapterForTask(task);
      if (target.name || options.forceUnload) {
        await loadAdapter(target.name);
      }

      const messages = task.messages || [
        { role: 'user', content: task.prompt || task.description || '' }
      ];

      const response = await LLMClient.chat(messages, modelConfig, null, task.chatOptions || {});
      _stats.tasks += 1;

      return {
        id: task.id || generateId('nc_task'),
        adapter: _activeAdapter,
        response
      };
    };

    const scheduleTasks = async (tasks = [], options = {}) => {
      if (!Array.isArray(tasks) || tasks.length === 0) return [];

      const classified = [];
      for (const task of tasks) {
        const adapter = await resolveAdapterForTask(task);
        classified.push({ task, adapter });
      }

      const batches = new Map();
      for (const item of classified) {
        const key = item.adapter.name || '__base__';
        if (!batches.has(key)) batches.set(key, []);
        batches.get(key).push(item.task);
      }

      const results = [];
      for (const [adapterName, batch] of batches.entries()) {
        await loadAdapter(adapterName === '__base__' ? null : adapterName);
        for (const task of batch) {
          const result = await executeTask(task, options);
          results.push(result);
        }
      }

      return results;
    };

    return {
      init,
      registerAdapter,
      stageTrainedAdapter,
      promoteTrainedAdapter,
      unregisterAdapter,
      listAdapters,
      getActiveAdapter,
      applyIntentBundle,
      executeTask,
      scheduleTasks
    };
  }
};

export default NeuralCompiler;
