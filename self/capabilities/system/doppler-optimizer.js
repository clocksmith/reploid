/**
 * @fileoverview Governed Doppler runtime-profile search for the X surface.
 */

const RUN_INDEX_PATH = '/artifacts/doppler/runs/index.json';
const ACTIVE_PROFILE_PATH = '/self/config/doppler/active-profile.json';

const DopplerOptimizer = {
  metadata: {
    id: 'DopplerOptimizer',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'EventBus', 'DopplerToolbox', 'AuditLogger?'],
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus, DopplerToolbox, AuditLogger } = deps;
    const { Errors, generateId, logger } = Utils;
    let activeRun = null;

    const asJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

    const readJson = async (path, fallback = null) => {
      if (!(await VFS.exists(path))) return fallback;
      try {
        return JSON.parse(await VFS.read(path));
      } catch (error) {
        throw new Errors.ArtifactError(`Invalid JSON at ${path}`, { cause: error.message });
      }
    };

    const writeJson = async (path, value) => {
      await VFS.write(path, asJson(value));
      return path;
    };

    const sha256Text = async (content) => {
      if (!globalThis.crypto?.subtle) {
        throw new Errors.ConfigError('SHA-256 is unavailable');
      }
      const bytes = new TextEncoder().encode(String(content));
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return `sha256:${Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')}`;
    };

    const safeRunId = (value) => {
      const normalized = String(value || '').trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
        throw new Errors.ValidationError('runId must contain only letters, numbers, underscores, and hyphens');
      }
      return normalized;
    };

    const pathsForRun = (runId) => {
      const id = safeRunId(runId);
      const artifactRoot = `/artifacts/doppler/runs/${id}`;
      const shadowRoot = `/shadow/doppler/runs/${id}`;
      return {
        artifactRoot,
        shadowRoot,
        contract: `${artifactRoot}/contract.json`,
        status: `${artifactRoot}/status.json`,
        decision: `${artifactRoot}/decision.json`,
        candidates: `${shadowRoot}/candidates`,
        receipts: `${artifactRoot}/receipts`
      };
    };

    const readRunIndex = async () => readJson(RUN_INDEX_PATH, {
      schema: 'reploid.doppler-optimization-run-index/v1',
      runs: []
    });

    const updateRunIndex = async (entry) => {
      const index = await readRunIndex();
      const runs = Array.isArray(index.runs) ? index.runs : [];
      const next = [entry, ...runs.filter((run) => run.runId !== entry.runId)].slice(0, 100);
      await writeJson(RUN_INDEX_PATH, { ...index, runs: next });
    };

    const emit = (type, detail = {}) => {
      EventBus?.emit?.(`doppler:optimization:${type}`, detail);
    };

    const recordAudit = async (event, detail, severity = 'INFO') => {
      if (AuditLogger?.logEvent) {
        await AuditLogger.logEvent(event, detail, severity);
      }
    };

    const rankReceipts = (left, right) => {
      const leftMedian = left?.measurement?.improvementPercent?.median;
      const rightMedian = right?.measurement?.improvementPercent?.median;
      if (Number.isFinite(leftMedian) && Number.isFinite(rightMedian) && leftMedian !== rightMedian) {
        return rightMedian - leftMedian;
      }
      const leftVariance = left?.measurement?.candidate?.relativeStdDevPercent;
      const rightVariance = right?.measurement?.candidate?.relativeStdDevPercent;
      if (Number.isFinite(leftVariance) && Number.isFinite(rightVariance) && leftVariance !== rightVariance) {
        return leftVariance - rightVariance;
      }
      return String(left?.candidateId || '').localeCompare(String(right?.candidateId || ''));
    };

    const run = async (contractInput, options = {}) => {
      if (activeRun) {
        throw new Errors.StateError(`Doppler optimization run already active: ${activeRun.runId}`);
      }
      const contract = await DopplerToolbox.tooling.optimization.validateContract(contractInput);
      const contractHash = await DopplerToolbox.tooling.optimization.hashContract(contract);
      const candidates = await DopplerToolbox.tooling.optimization.enumerateCandidates(contract);
      const runId = safeRunId(options.runId || generateId('doppler_opt'));
      const paths = pathsForRun(runId);
      const abortController = new AbortController();
      activeRun = { runId, abortController, candidateIndex: -1, candidateCount: candidates.length };

      const startedAt = new Date().toISOString();
      await writeJson(paths.contract, contract);
      await writeJson(paths.status, {
        schema: 'reploid.doppler-optimization-status/v1',
        runId,
        contractHash,
        state: 'running',
        startedAt,
        completedAt: null,
        candidateCount: candidates.length,
        completedCandidates: 0,
        acceptedCandidates: 0,
        error: null
      });
      await updateRunIndex({ runId, contractHash, state: 'running', startedAt, completedAt: null });
      emit('run-started', { runId, contractHash, candidateCount: candidates.length });
      await recordAudit('DOPPLER_OPTIMIZATION_STARTED', { runId, contractHash, candidateCount: candidates.length });

      const receipts = [];
      try {
        for (let index = 0; index < candidates.length; index += 1) {
          if (abortController.signal.aborted) {
            throw new Errors.AbortError('Doppler optimization run cancelled');
          }
          const candidate = candidates[index];
          activeRun.candidateIndex = index;
          const candidatePath = `${paths.candidates}/${candidate.candidateId}.json`;
          const receiptPath = `${paths.receipts}/${candidate.candidateId}.json`;
          await writeJson(candidatePath, candidate);
          emit('candidate-started', { runId, index, candidateCount: candidates.length, candidate });
          let receipt;
          try {
            receipt = await DopplerToolbox.tooling.optimization.evaluateCandidate(
              contract,
              candidate,
              {
                signal: abortController.signal,
                onEvent: (event) => emit('evaluator-event', { runId, candidateId: candidate.candidateId, event })
              }
            );
          } catch (error) {
            if (abortController.signal.aborted || error?.name === 'AbortError') throw error;
            receipt = {
              schema: 'reploid.doppler-optimization-attempt/v1',
              runId,
              contractHash,
              candidateId: candidate.candidateId,
              candidateHash: null,
              receiptHash: null,
              verification: { passed: false },
              measurement: null,
              decision: {
                accepted: false,
                reasons: [`evaluation failed: ${error?.message || String(error)}`]
              },
              error: {
                name: error?.name || 'Error',
                message: error?.message || String(error)
              }
            };
          }
          await writeJson(receiptPath, receipt);
          receipts.push({ ...receipt, receiptPath, candidatePath });
          const acceptedCandidates = receipts.filter((entry) => entry.decision?.accepted === true).length;
          await writeJson(paths.status, {
            schema: 'reploid.doppler-optimization-status/v1',
            runId,
            contractHash,
            state: 'running',
            startedAt,
            completedAt: null,
            candidateCount: candidates.length,
            completedCandidates: receipts.length,
            acceptedCandidates,
            error: null
          });
          emit('candidate-completed', { runId, index, candidateCount: candidates.length, receipt });
        }

        const accepted = receipts.filter((receipt) => receipt.decision?.accepted === true).sort(rankReceipts);
        const selected = accepted[0] || null;
        const completedAt = new Date().toISOString();
        const decision = {
          schema: 'reploid.doppler-optimization-decision/v1',
          runId,
          contractHash,
          candidateCount: candidates.length,
          acceptedCandidateCount: accepted.length,
          selectedCandidateId: selected?.candidateId ?? null,
          selectedCandidateHash: selected?.candidateHash ?? null,
          selectedReceiptHash: selected?.receiptHash ?? null,
          selectedReceiptPath: selected?.receiptPath ?? null,
          ranking: accepted.map((receipt) => ({
            candidateId: receipt.candidateId,
            candidateHash: receipt.candidateHash,
            receiptHash: receipt.receiptHash,
            receiptPath: receipt.receiptPath,
            improvementPercent: receipt.measurement?.improvementPercent?.median ?? null,
            relativeStdDevPercent: receipt.measurement?.candidate?.relativeStdDevPercent ?? null
          })),
          completedAt
        };
        await writeJson(paths.decision, decision);
        await writeJson(paths.status, {
          schema: 'reploid.doppler-optimization-status/v1',
          runId,
          contractHash,
          state: 'complete',
          startedAt,
          completedAt,
          candidateCount: candidates.length,
          completedCandidates: receipts.length,
          acceptedCandidates: accepted.length,
          error: null
        });
        await updateRunIndex({ runId, contractHash, state: 'complete', startedAt, completedAt });
        emit('run-completed', { runId, decision });
        await recordAudit('DOPPLER_OPTIMIZATION_COMPLETED', {
          runId,
          contractHash,
          acceptedCandidates: accepted.length,
          selectedCandidateId: decision.selectedCandidateId
        });
        return { runId, paths, decision };
      } catch (error) {
        const completedAt = new Date().toISOString();
        const state = error?.name === 'AbortError' ? 'cancelled' : 'failed';
        const failure = { name: error?.name || 'Error', message: error?.message || String(error) };
        await writeJson(paths.status, {
          schema: 'reploid.doppler-optimization-status/v1',
          runId,
          contractHash,
          state,
          startedAt,
          completedAt,
          candidateCount: candidates.length,
          completedCandidates: receipts.length,
          acceptedCandidates: receipts.filter((receipt) => receipt.decision?.accepted === true).length,
          error: failure
        });
        await updateRunIndex({ runId, contractHash, state, startedAt, completedAt });
        emit('run-failed', { runId, state, error: failure });
        await recordAudit('DOPPLER_OPTIMIZATION_FAILED', { runId, state, error: failure }, 'WARN');
        throw error;
      } finally {
        activeRun = null;
      }
    };

    const cancel = () => {
      if (!activeRun) return false;
      activeRun.abortController.abort();
      return true;
    };

    const getState = () => activeRun
      ? {
        running: true,
        runId: activeRun.runId,
        candidateIndex: activeRun.candidateIndex,
        candidateCount: activeRun.candidateCount
      }
      : { running: false, runId: null, candidateIndex: -1, candidateCount: 0 };

    const listRuns = async () => (await readRunIndex()).runs || [];

    const getRun = async (runId) => {
      const paths = pathsForRun(runId);
      const status = await readJson(paths.status, null);
      if (!status) return null;
      const receiptPaths = (await VFS.list(paths.receipts))
        .filter((path) => path.endsWith('.json'))
        .sort();
      const receipts = [];
      for (const receiptPath of receiptPaths) {
        const receipt = await readJson(receiptPath, null);
        if (!receipt) continue;
        const candidatePath = receipt.candidateId
          ? `${paths.candidates}/${receipt.candidateId}.json`
          : null;
        const candidate = candidatePath ? await readJson(candidatePath, null) : null;
        receipts.push({ ...receipt, receiptPath, candidatePath, candidate });
      }
      return {
        runId: safeRunId(runId),
        paths,
        status,
        contract: await readJson(paths.contract, null),
        decision: await readJson(paths.decision, null),
        receipts
      };
    };

    const getActiveProfile = async () => readJson(ACTIVE_PROFILE_PATH, null);

    const preparePromotion = async (runId, requestedCandidateId = null) => {
      const runRecord = await getRun(runId);
      if (!runRecord || runRecord.status?.state !== 'complete' || !runRecord.decision) {
        throw new Errors.StateError(`Optimization run is not complete: ${runId}`);
      }
      const candidateId = requestedCandidateId || runRecord.decision.selectedCandidateId;
      if (!candidateId) {
        throw new Errors.StateError(`Optimization run has no accepted candidate: ${runId}`);
      }
      const receiptPath = `${runRecord.paths.receipts}/${candidateId}.json`;
      const candidatePath = `${runRecord.paths.candidates}/${candidateId}.json`;
      const receipt = await readJson(receiptPath, null);
      const candidate = await readJson(candidatePath, null);
      if (!receipt || !candidate || receipt.decision?.accepted !== true) {
        throw new Errors.StateError(`Candidate is not accepted: ${candidateId}`);
      }
      const runtimeInputs = await DopplerToolbox.tooling.optimization.materializeCandidate(
        runRecord.contract,
        candidate
      );
      const replayReceipt = await DopplerToolbox.tooling.optimization.evaluateCandidate(
        runRecord.contract,
        candidate
      );
      if (replayReceipt.decision?.accepted !== true) {
        throw new Errors.ValidationError(`Promotion replay rejected candidate: ${candidateId}`);
      }
      if (
        replayReceipt.contractHash !== receipt.contractHash
        || replayReceipt.candidateHash !== receipt.candidateHash
      ) {
        throw new Errors.ArtifactError('Promotion replay identity does not match the selected receipt');
      }
      const replayKey = String(replayReceipt.receiptHash || '').replace(/^sha256:/, '');
      if (!/^[0-9a-f]{64}$/.test(replayKey)) {
        throw new Errors.ArtifactError('Promotion replay did not return a valid receipt hash');
      }
      const replayReceiptPath = `/artifacts/doppler/promotion-replays/${replayKey}.json`;
      await writeJson(replayReceiptPath, replayReceipt);
      const runtimeConfigHash = await sha256Text(asJson(runtimeInputs.runtimeConfig));
      const profile = {
        schema: 'reploid.doppler-runtime-profile/v1',
        profileId: `${runId}-${candidateId}`,
        runId,
        candidateId,
        modelId: runRecord.contract.model.modelId,
        contractHash: replayReceipt.contractHash,
        optimizationCandidateHash: replayReceipt.candidateHash,
        selectionReceiptHash: receipt.receiptHash,
        selectionReceiptPath: receiptPath,
        receiptHash: replayReceipt.receiptHash,
        receiptPath: replayReceiptPath,
        runtimeConfigHash,
        runtimeConfig: runtimeInputs.runtimeConfig
      };
      const profileContent = asJson(profile);
      const profileHash = await sha256Text(profileContent);
      const profileKey = profileHash.slice('sha256:'.length);
      const shadowProfilePath = `/shadow/doppler/profiles/${profileKey}.json`;
      const targetProfilePath = `/self/config/doppler/profiles/${profileKey}.json`;
      const evidencePath = `/artifacts/doppler/promotions/${profileKey}/evidence.json`;
      await VFS.write(shadowProfilePath, profileContent);
      await writeJson(evidencePath, {
        schema: 'reploid.doppler-profile-promotion-evidence/v1',
        candidatePath: shadowProfilePath,
        targetPath: targetProfilePath,
        evidencePath,
        replayPassed: true,
        candidateHash: profileHash.slice('sha256:'.length),
        optimization: {
          runId,
          contractHash: receipt.contractHash,
          candidateId,
          candidateHash: receipt.candidateHash,
          selectionReceiptHash: receipt.receiptHash,
          selectionReceiptPath: receiptPath,
          replayReceiptHash: replayReceipt.receiptHash,
          replayReceiptPath,
          decisionPath: runRecord.paths.decision,
          profileHash,
          runtimeConfigHash
        }
      });
      return {
        runId,
        candidateId,
        profile,
        profileHash,
        candidatePath: shadowProfilePath,
        targetPath: targetProfilePath,
        evidencePath,
        promoteArgs: {
          candidatePath: shadowProfilePath,
          targetPath: targetProfilePath,
          evidencePath
        }
      };
    };

    const applyProfileToRuntime = async (profile, profileHash) => {
      globalThis.REPLOID_DOPPLER_LOAD_OPTIONS = {
        scopeModelId: profile.modelId,
        runtimeConfig: profile.runtimeConfig,
        isolatedLoader: true,
        optimizationProfileHash: profileHash
      };
      await DopplerToolbox.resetProvider();
    };

    const clearProfileFromRuntime = async () => {
      delete globalThis.REPLOID_DOPPLER_LOAD_OPTIONS;
      await DopplerToolbox.resetProvider();
    };

    const restoreActiveProfile = async () => {
      const pointer = await readJson(ACTIVE_PROFILE_PATH, null);
      if (!pointer?.targetPath || pointer.state !== 'active') return null;
      const content = await VFS.read(pointer.targetPath);
      const actualHash = await sha256Text(content);
      if (actualHash !== pointer.profileHash) {
        throw new Errors.ArtifactError('Active Doppler profile hash mismatch');
      }
      let profile;
      try {
        profile = JSON.parse(content);
      } catch (error) {
        throw new Errors.ArtifactError('Active Doppler profile is not valid JSON', {
          cause: error?.message || String(error)
        });
      }
      if (
        profile.schema !== 'reploid.doppler-runtime-profile/v1'
        || profile.modelId !== pointer.modelId
      ) {
        throw new Errors.ArtifactError('Active Doppler profile identity mismatch');
      }
      const runtimeConfigHash = await sha256Text(asJson(profile.runtimeConfig));
      if (runtimeConfigHash !== profile.runtimeConfigHash) {
        throw new Errors.ArtifactError('Active Doppler runtime config hash mismatch');
      }
      await applyProfileToRuntime(profile, actualHash);
      return pointer;
    };

    const activatePromotedProfile = async (prepared, promotionResult) => {
      if (!prepared?.targetPath || !prepared?.profileHash || !prepared?.runId || !prepared?.candidateId) {
        throw new Errors.ValidationError('Prepared promotion descriptor is incomplete');
      }
      if (promotionResult?.promoted !== true || promotionResult?.targetPath !== prepared.targetPath) {
        throw new Errors.StateError('Profile activation requires a successful matching Promote result');
      }
      const targetContent = await VFS.read(prepared.targetPath);
      const targetHash = await sha256Text(targetContent);
      if (targetHash !== prepared.profileHash) {
        throw new Errors.ArtifactError('Promoted Doppler profile does not match the prepared hash');
      }
      let promotedProfile;
      try {
        promotedProfile = JSON.parse(targetContent);
      } catch (error) {
        throw new Errors.ArtifactError('Promoted Doppler profile is not valid JSON', {
          cause: error?.message || String(error)
        });
      }
      if (
        promotedProfile.schema !== 'reploid.doppler-runtime-profile/v1'
        || promotedProfile.runId !== prepared.runId
        || promotedProfile.candidateId !== prepared.candidateId
      ) {
        throw new Errors.ArtifactError('Promoted Doppler profile identity does not match the prepared candidate');
      }
      const previousPointerContent = await VFS.exists(ACTIVE_PROFILE_PATH)
        ? await VFS.read(ACTIVE_PROFILE_PATH)
        : null;
      const previousPointerHash = previousPointerContent === null
        ? null
        : await sha256Text(previousPointerContent);
      const canaryPointer = {
        schema: 'reploid.doppler-active-profile/v1',
        state: 'canary',
        modelId: promotedProfile.modelId,
        targetPath: prepared.targetPath,
        profileHash: prepared.profileHash,
        runId: prepared.runId,
        candidateId: prepared.candidateId,
        previousPointerHash,
        canaryReceiptPath: null,
        activatedAt: null
      };
      await writeJson(ACTIVE_PROFILE_PATH, canaryPointer);

      const canaryRoot = `/artifacts/doppler/promotions/${prepared.profileHash.slice('sha256:'.length)}`;
      const canaryReceiptPath = `${canaryRoot}/canary.json`;
      const rollbackPath = `${canaryRoot}/rollback.json`;
      try {
        const runRecord = await getRun(prepared.runId);
        if (!runRecord) throw new Errors.StateError(`Optimization run not found: ${prepared.runId}`);
        const candidate = await readJson(
          `${runRecord.paths.candidates}/${prepared.candidateId}.json`,
          null
        );
        if (!candidate) throw new Errors.ArtifactError('Promoted optimization candidate is missing');
        const runtimeInputs = await DopplerToolbox.tooling.optimization.materializeCandidate(
          runRecord.contract,
          candidate
        );
        const materializedConfigHash = await sha256Text(asJson(runtimeInputs.runtimeConfig));
        if (
          materializedConfigHash !== promotedProfile.runtimeConfigHash
          || materializedConfigHash !== await sha256Text(asJson(promotedProfile.runtimeConfig))
        ) {
          throw new Errors.ArtifactError('Canary candidate runtime config does not match promoted profile bytes');
        }
        const canaryReceipt = await DopplerToolbox.tooling.optimization.evaluateCandidate(
          runRecord.contract,
          candidate
        );
        await writeJson(canaryReceiptPath, canaryReceipt);
        if (
          canaryReceipt.contractHash !== promotedProfile.contractHash
          || canaryReceipt.candidateHash !== promotedProfile.optimizationCandidateHash
        ) {
          throw new Errors.ArtifactError('Canary receipt identity does not match promoted profile');
        }
        if (canaryReceipt.decision?.accepted !== true) {
          throw new Errors.ValidationError('Canary evaluation rejected the promoted profile');
        }
        const activePointer = {
          ...canaryPointer,
          state: 'active',
          canaryReceiptPath,
          canaryReceiptHash: canaryReceipt.receiptHash,
          activatedAt: new Date().toISOString()
        };
        await writeJson(ACTIVE_PROFILE_PATH, activePointer);
        await applyProfileToRuntime(promotedProfile, prepared.profileHash);
        emit('profile-activated', { pointer: activePointer });
        await recordAudit('DOPPLER_PROFILE_ACTIVATED', activePointer);
        return { ok: true, activated: true, pointer: activePointer, canaryReceipt };
      } catch (error) {
        if (previousPointerContent === null) {
          await VFS.delete(ACTIVE_PROFILE_PATH);
          await clearProfileFromRuntime();
        } else {
          await VFS.write(ACTIVE_PROFILE_PATH, previousPointerContent);
          await restoreActiveProfile();
        }
        const rollback = {
          schema: 'reploid.doppler-profile-rollback/v1',
          runId: prepared.runId,
          candidateId: prepared.candidateId,
          rejectedProfileHash: prepared.profileHash,
          previousPointerHash,
          restored: true,
          reason: error?.message || String(error),
          rolledBackAt: new Date().toISOString()
        };
        await writeJson(rollbackPath, rollback);
        emit('profile-rolled-back', rollback);
        await recordAudit('DOPPLER_PROFILE_ROLLED_BACK', rollback, 'WARN');
        return { ok: false, activated: false, rollback, rollbackPath };
      }
    };

    return {
      run,
      cancel,
      getState,
      listRuns,
      getRun,
      getActiveProfile,
      preparePromotion,
      activatePromotedProfile,
      restoreActiveProfile,
      pathsForRun
    };
  }
};

export default DopplerOptimizer;
