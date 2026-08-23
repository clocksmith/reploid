// self/reward-policy.js
var DEFAULT_REWARD_POLICY = Object.freeze({
  outputPointsPer1k: 1,
  inputPointsPer1k: 0.25,
  diversityBonus: 0.15,
  repeatedPairCap: 3,
  minCountedTokens: 128,
  scoreHalfLifeMs: 1e3 * 60 * 60 * 24 * 30
});

// self/swarm.js
var SWARM_ROLES = Object.freeze({
  SOLO: "solo",
  PROVIDER: "provider",
  CONSUMER: "consumer",
  DEAD: "dead"
});

// self/identity.js
var encoder = new TextEncoder();
var stableJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
var getCryptoApi = (cryptoApi) => {
  const api = cryptoApi || globalThis.crypto;
  if (!api?.subtle) {
    throw new Error("WebCrypto unavailable");
  }
  return api;
};
var fromBase64Url = (value) => {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(padded, "base64"));
  }
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
async function sha256Hex(text, cryptoApi = globalThis.crypto) {
  const digest = await getCryptoApi(cryptoApi).subtle.digest("SHA-256", encoder.encode(String(text || "")));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function inferIdentityAlgorithm(bundleOrJwk = {}) {
  const algorithm = String(bundleOrJwk?.algorithm || "").trim();
  const crv = String(bundleOrJwk?.crv || bundleOrJwk?.publicJwk?.crv || "").trim();
  if (algorithm === "Ed25519" || crv === "Ed25519") {
    return "Ed25519";
  }
  return "ECDSA";
}
function getIdentityImportAlgorithm(bundleOrJwk = {}) {
  return inferIdentityAlgorithm(bundleOrJwk) === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", namedCurve: "P-256" };
}
function getIdentitySignAlgorithm(bundleOrJwk = {}) {
  return inferIdentityAlgorithm(bundleOrJwk) === "Ed25519" ? { name: "Ed25519" } : { name: "ECDSA", hash: "SHA-256" };
}
async function createPeerIdFromPublicJwk(publicJwk, cryptoApi = globalThis.crypto) {
  const publicShape = publicJwk ? {
    kty: publicJwk.kty || null,
    crv: publicJwk.crv || null,
    x: publicJwk.x || null,
    y: publicJwk.y || null,
    n: publicJwk.n || null,
    e: publicJwk.e || null
  } : {};
  const digest = await sha256Hex(stableJson(publicShape), cryptoApi);
  return `peer:${digest.slice(0, 24)}`;
}
async function importVerificationKey(bundleOrJwk, cryptoApi = globalThis.crypto) {
  const publicJwk = bundleOrJwk?.publicJwk || bundleOrJwk;
  if (!publicJwk) {
    throw new Error("Missing public JWK");
  }
  return getCryptoApi(cryptoApi).subtle.importKey(
    "jwk",
    publicJwk,
    getIdentityImportAlgorithm(publicJwk),
    false,
    ["verify"]
  );
}
function encodeBytes(value) {
  return encoder.encode(String(value || ""));
}

// self/shared/change-passport/contract.js
var CHANGE_PASSPORT_SCHEMA = "change.passport/v1";
var CHANGE_PASSPORT_EVENT_SCHEMA = "change.passport-event/v1";
var CHANGE_PASSPORT_EXPORT_SCHEMA = "change.passport-export/v1";
var CHANGE_CLASSES = Object.freeze([
  "model",
  "prompt",
  "agent_tool",
  "agent_policy",
  "agent_configuration",
  "source_patch"
]);
var CHANGE_PASSPORT_EVENT_TYPES = Object.freeze([
  "passport.created",
  "proposal.recorded",
  "evidence.admitted",
  "evidence.excluded",
  "evidence.frozen",
  "evidence.invalidated",
  "objection.recorded",
  "evaluation.recorded",
  "review.recorded",
  "decision.recorded",
  "effect.requested",
  "effect.recorded",
  "outcome.recorded",
  "trigger.declared",
  "trigger.observed",
  "decision.reopened",
  "decision.revoked",
  "rollback.requested",
  "rollback.recorded",
  "passport.superseded"
]);
var EVENT_TYPE_SET = new Set(CHANGE_PASSPORT_EVENT_TYPES);
var HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
var SAFE_ID_PATTERN = /^[a-zA-Z0-9._:@/+~-]+$/;
var isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var cloneJson = (value) => JSON.parse(JSON.stringify(value));
var canonicalChangePassportJson = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Change Passport contains a non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalChangePassportJson).join(",")}]`;
  }
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalChangePassportJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`Change Passport contains unsupported ${typeof value}`);
};
async function hashChangePassportValue(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error("SHA-256 is unavailable");
  const digest = await cryptoApi.subtle.digest(
    "SHA-256",
    encodeBytes(canonicalChangePassportJson(value))
  );
  return `sha256:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
var requiredText = (value, label, max = 4e3) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return normalized;
};
var optionalText = (value, max = 4e3) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new Error(`text exceeds ${max} characters`);
  return normalized;
};
var requiredId = (value, label) => {
  const normalized = requiredText(value, label, 500);
  if (!SAFE_ID_PATTERN.test(normalized)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  return normalized;
};
var requiredHash = (value, label) => {
  const normalized = requiredText(value, label, 80).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) throw new Error(`${label} must be a SHA-256 identity`);
  return normalized;
};
var optionalHash = (value, label) => value === void 0 || value === null || value === "" ? null : requiredHash(value, label);
var requiredTimestamp = (value, label) => {
  const normalized = requiredText(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${label} must be an ISO timestamp`);
  return normalized;
};
var stringArray = (value, label, { allowEmpty = true } = {}) => {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0) {
    throw new Error(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  return [...new Set(value.map((entry, index) => requiredText(entry, `${label}[${index}]`, 1e3)))];
};
var normalizeActor = (actor = {}) => ({
  authorityId: requiredId(actor.authorityId, "actor.authorityId"),
  organizationId: requiredId(actor.organizationId, "actor.organizationId"),
  role: requiredId(actor.role, "actor.role"),
  authentication: {
    kind: requiredId(actor.authentication?.kind || "identity_signature", "actor.authentication.kind"),
    subject: optionalText(actor.authentication?.subject, 1e3),
    contextHash: optionalHash(actor.authentication?.contextHash, "actor.authentication.contextHash")
  }
});
var normalizeRepository = (repository = {}) => ({
  provider: requiredId(repository.provider || "github", "proposal.repository.provider"),
  owner: requiredId(repository.owner, "proposal.repository.owner"),
  name: requiredId(repository.name, "proposal.repository.name"),
  repositoryId: requiredId(repository.repositoryId, "proposal.repository.repositoryId"),
  installationId: Number.isInteger(Number(repository.installationId)) ? Number(repository.installationId) : null,
  defaultBranch: requiredId(repository.defaultBranch || "main", "proposal.repository.defaultBranch"),
  visibility: ["public", "private", "internal"].includes(repository.visibility) ? repository.visibility : "private"
});
var normalizeProposal = (proposal = {}) => ({
  proposalId: requiredId(proposal.proposalId, "proposal.proposalId"),
  title: requiredText(proposal.title, "proposal.title", 500),
  summary: requiredText(proposal.summary, "proposal.summary", 4e3),
  repository: normalizeRepository(proposal.repository),
  pullRequestNumber: Number.isInteger(Number(proposal.pullRequestNumber)) ? Number(proposal.pullRequestNumber) : null,
  baseRevision: requiredText(proposal.baseRevision, "proposal.baseRevision", 160),
  candidateRevision: requiredText(proposal.candidateRevision, "proposal.candidateRevision", 160),
  baselineHash: requiredHash(proposal.baselineHash, "proposal.baselineHash"),
  candidateHash: requiredHash(proposal.candidateHash, "proposal.candidateHash"),
  manifestHash: requiredHash(proposal.manifestHash, "proposal.manifestHash"),
  target: {
    kind: requiredId(proposal.target?.kind, "proposal.target.kind"),
    targetId: requiredId(proposal.target?.targetId, "proposal.target.targetId"),
    environment: requiredId(proposal.target?.environment, "proposal.target.environment")
  },
  proposerAuthorityId: requiredId(proposal.proposerAuthorityId, "proposal.proposerAuthorityId")
});
var normalizeEvaluator = (evaluator = {}) => ({
  evaluatorId: requiredId(evaluator.evaluatorId, "evaluator.evaluatorId"),
  authorityId: requiredId(evaluator.authorityId, "evaluator.authorityId"),
  version: requiredText(evaluator.version, "evaluator.version", 160),
  evaluatorHash: requiredHash(evaluator.evaluatorHash, "evaluator.evaluatorHash"),
  suiteHash: requiredHash(evaluator.suiteHash, "evaluator.suiteHash"),
  contractHash: requiredHash(evaluator.contractHash, "evaluator.contractHash"),
  frozenBeforeCandidate: evaluator.frozenBeforeCandidate === true
});
var normalizeRollback = (rollback = {}) => ({
  kind: requiredId(rollback.kind, "rollback.kind"),
  targetId: requiredId(rollback.targetId, "rollback.targetId"),
  revision: requiredText(rollback.revision, "rollback.revision", 160),
  artifactHash: requiredHash(rollback.artifactHash, "rollback.artifactHash"),
  authorityId: requiredId(rollback.authorityId, "rollback.authorityId")
});
var normalizeBudget = (budget = {}) => {
  const normalized = {
    calls: Number(budget.calls),
    elapsedMilliseconds: Number(budget.elapsedMilliseconds),
    costAmount: Number(budget.costAmount),
    costUnit: requiredText(budget.costUnit, "budget.costUnit", 80)
  };
  for (const [key, value] of Object.entries(normalized)) {
    if (key === "costUnit") continue;
    if (!Number.isFinite(value) || value < 0) throw new Error(`budget.${key} must be non-negative`);
  }
  return normalized;
};
function normalizeChangePassportStart(input = {}) {
  const changeClass = requiredId(input.changeClass, "changeClass");
  if (!CHANGE_CLASSES.includes(changeClass)) throw new Error("changeClass is unsupported");
  const evidenceCutoff = requiredTimestamp(input.evidenceCutoff, "evidenceCutoff");
  const createdAt = requiredTimestamp(input.createdAt, "createdAt");
  if (Date.parse(evidenceCutoff) > Date.parse(createdAt)) {
    throw new Error("evidenceCutoff cannot be after createdAt");
  }
  const policy = cloneJson(input.policy || {});
  policy.schema = requiredText(policy.schema, "policy.schema", 120);
  policy.policyId = requiredId(policy.policyId, "policy.policyId");
  policy.version = requiredText(policy.version, "policy.version", 120);
  policy.policyHash = requiredHash(policy.policyHash, "policy.policyHash");
  const proposal = normalizeProposal(input.proposal);
  const evaluator = normalizeEvaluator(input.evaluator);
  if (proposal.proposerAuthorityId === evaluator.authorityId) {
    throw new Error("proposer and evaluator authority must be distinct");
  }
  return {
    passportId: requiredId(input.passportId, "passportId"),
    organizationId: requiredId(input.organizationId, "organizationId"),
    changeClass,
    proposal,
    policy,
    evaluator,
    budget: normalizeBudget(input.budget),
    rollback: normalizeRollback(input.rollback),
    evidenceCutoff,
    createdAt,
    sourceEpisode: input.sourceEpisode ? {
      schema: requiredText(input.sourceEpisode.schema, "sourceEpisode.schema", 120),
      episodeId: requiredId(input.sourceEpisode.episodeId, "sourceEpisode.episodeId"),
      projectionHash: requiredHash(input.sourceEpisode.projectionHash, "sourceEpisode.projectionHash")
    } : null
  };
}
var normalizeEvidencePayload = (payload = {}, excluded = false) => ({
  evidenceId: requiredId(payload.evidenceId, "evidence.evidenceId"),
  kind: requiredId(payload.kind, "evidence.kind"),
  digest: requiredHash(payload.digest, "evidence.digest"),
  source: requiredText(payload.source, "evidence.source", 1e3),
  uri: optionalText(payload.uri, 2e3),
  summary: requiredText(payload.summary, "evidence.summary", 4e3),
  observedAt: requiredTimestamp(payload.observedAt, "evidence.observedAt"),
  custody: {
    mode: requiredId(payload.custody?.mode || "reference_only", "evidence.custody.mode"),
    accessRequired: payload.custody?.accessRequired !== false,
    retention: requiredText(payload.custody?.retention || "source_owned", "evidence.custody.retention", 500)
  },
  reason: excluded ? requiredText(payload.reason, "evidence.reason", 2e3) : null
});
var normalizeTrigger = (payload = {}, observed = false) => ({
  ruleId: requiredId(payload.ruleId, "trigger.ruleId"),
  sourceKind: requiredId(payload.sourceKind, "trigger.sourceKind"),
  observationKind: requiredId(payload.observationKind, "trigger.observationKind"),
  targetId: requiredId(payload.targetId, "trigger.targetId"),
  action: requiredId(payload.action, "trigger.action"),
  condition: isObject(payload.condition) ? cloneJson(payload.condition) : !observed && isObject(payload.match) ? cloneJson(payload.match) : {},
  sensorAuthorityId: requiredId(payload.sensorAuthorityId, "trigger.sensorAuthorityId"),
  observationHash: observed ? requiredHash(payload.observationHash, "trigger.observationHash") : optionalHash(payload.observationHash, "trigger.observationHash"),
  observedAt: observed ? requiredTimestamp(payload.observedAt, "trigger.observedAt") : null,
  freshnessMilliseconds: Number.isFinite(Number(payload.freshnessMilliseconds)) ? Number(payload.freshnessMilliseconds) : null,
  deduplicationKey: observed ? requiredId(payload.deduplicationKey, "trigger.deduplicationKey") : null
});
function normalizeChangePassportEventPayload(type, payload = {}) {
  switch (type) {
    case "passport.created":
      return normalizeChangePassportStart(payload);
    case "proposal.recorded":
      return normalizeProposal(payload);
    case "evidence.admitted":
      return normalizeEvidencePayload(payload, false);
    case "evidence.excluded":
      return normalizeEvidencePayload(payload, true);
    case "evidence.frozen":
      return {
        manifestHash: requiredHash(payload.manifestHash, "evidence.manifestHash"),
        evidenceIds: stringArray(payload.evidenceIds, "evidence.evidenceIds", { allowEmpty: false }).sort(),
        cutoff: requiredTimestamp(payload.cutoff, "evidence.cutoff")
      };
    case "evidence.invalidated":
      return {
        evidenceId: requiredId(payload.evidenceId, "evidence.evidenceId"),
        reason: requiredText(payload.reason, "evidence.reason", 2e3),
        invalidationHash: requiredHash(payload.invalidationHash, "evidence.invalidationHash")
      };
    case "objection.recorded":
      return {
        objectionId: requiredId(payload.objectionId, "objection.objectionId"),
        statement: requiredText(payload.statement, "objection.statement", 4e3),
        evidenceIds: stringArray(payload.evidenceIds || [], "objection.evidenceIds"),
        severity: ["blocking", "non_blocking"].includes(payload.severity) ? payload.severity : "blocking",
        resolution: null
      };
    case "evaluation.recorded":
      return {
        evaluationId: requiredId(payload.evaluationId, "evaluation.evaluationId"),
        evaluatorId: requiredId(payload.evaluatorId, "evaluation.evaluatorId"),
        evaluatorAuthorityId: requiredId(payload.evaluatorAuthorityId, "evaluation.evaluatorAuthorityId"),
        evaluatorHash: requiredHash(payload.evaluatorHash, "evaluation.evaluatorHash"),
        suiteHash: requiredHash(payload.suiteHash, "evaluation.suiteHash"),
        contractHash: requiredHash(payload.contractHash, "evaluation.contractHash"),
        baselineHash: requiredHash(payload.baselineHash, "evaluation.baselineHash"),
        candidateHash: requiredHash(payload.candidateHash, "evaluation.candidateHash"),
        evidenceManifestHash: requiredHash(payload.evidenceManifestHash, "evaluation.evidenceManifestHash"),
        conclusion: ["pass", "fail", "inconclusive"].includes(payload.conclusion) ? payload.conclusion : (() => {
          throw new Error("evaluation.conclusion is invalid");
        })(),
        metrics: Array.isArray(payload.metrics) ? cloneJson(payload.metrics) : [],
        limitations: stringArray(payload.limitations || [], "evaluation.limitations"),
        observedAt: requiredTimestamp(payload.observedAt, "evaluation.observedAt")
      };
    case "review.recorded":
      return {
        reviewId: requiredId(payload.reviewId, "review.reviewId"),
        verdict: ["approve", "reject", "contest", "unresolved", "request_evidence"].includes(payload.verdict) ? payload.verdict : (() => {
          throw new Error("review.verdict is invalid");
        })(),
        rationale: requiredText(payload.rationale, "review.rationale", 4e3),
        resolvesObjectionIds: stringArray(payload.resolvesObjectionIds || [], "review.resolvesObjectionIds"),
        evidenceIds: stringArray(payload.evidenceIds || [], "review.evidenceIds")
      };
    case "decision.recorded":
      return {
        decisionId: requiredId(payload.decisionId, "decision.decisionId"),
        state: ["approved", "rejected", "unresolved"].includes(payload.state) ? payload.state : (() => {
          throw new Error("decision.state is invalid");
        })(),
        policyHash: requiredHash(payload.policyHash, "decision.policyHash"),
        evaluationIds: stringArray(payload.evaluationIds, "decision.evaluationIds", { allowEmpty: false }).sort(),
        reviewIds: stringArray(payload.reviewIds, "decision.reviewIds", { allowEmpty: false }).sort(),
        rationale: requiredText(payload.rationale, "decision.rationale", 4e3)
      };
    case "effect.requested":
      return {
        effectId: requiredId(payload.effectId, "effect.effectId"),
        kind: requiredId(payload.kind, "effect.kind"),
        targetId: requiredId(payload.targetId, "effect.targetId"),
        candidateHash: requiredHash(payload.candidateHash, "effect.candidateHash"),
        decisionEventHash: requiredHash(payload.decisionEventHash, "effect.decisionEventHash"),
        idempotencyKey: requiredId(payload.idempotencyKey, "effect.idempotencyKey")
      };
    case "effect.recorded":
      return {
        effectId: requiredId(payload.effectId, "effect.effectId"),
        status: ["applied", "failed"].includes(payload.status) ? payload.status : (() => {
          throw new Error("effect.status is invalid");
        })(),
        targetId: requiredId(payload.targetId, "effect.targetId"),
        candidateHash: requiredHash(payload.candidateHash, "effect.candidateHash"),
        externalReference: requiredText(payload.externalReference, "effect.externalReference", 2e3),
        observedAt: requiredTimestamp(payload.observedAt, "effect.observedAt"),
        failureReason: payload.status === "failed" ? requiredText(payload.failureReason, "effect.failureReason", 2e3) : null
      };
    case "outcome.recorded":
      return {
        outcomeId: requiredId(payload.outcomeId, "outcome.outcomeId"),
        effectId: requiredId(payload.effectId, "outcome.effectId"),
        observationHash: requiredHash(payload.observationHash, "outcome.observationHash"),
        source: requiredText(payload.source, "outcome.source", 1e3),
        status: requiredId(payload.status, "outcome.status"),
        summary: requiredText(payload.summary, "outcome.summary", 4e3),
        observedAt: requiredTimestamp(payload.observedAt, "outcome.observedAt")
      };
    case "trigger.declared":
      return normalizeTrigger(payload, false);
    case "trigger.observed":
      return normalizeTrigger(payload, true);
    case "decision.reopened":
      return {
        reopeningId: requiredId(payload.reopeningId, "reopening.reopeningId"),
        ruleId: requiredId(payload.ruleId, "reopening.ruleId"),
        triggerEventHash: requiredHash(payload.triggerEventHash, "reopening.triggerEventHash"),
        requestedAction: requiredId(payload.requestedAction, "reopening.requestedAction"),
        reason: requiredText(payload.reason, "reopening.reason", 4e3)
      };
    case "decision.revoked":
      return {
        revocationId: requiredId(payload.revocationId, "revocation.revocationId"),
        reason: requiredText(payload.reason, "revocation.reason", 4e3),
        basisEventHashes: stringArray(payload.basisEventHashes, "revocation.basisEventHashes", { allowEmpty: false }).map((hash, index) => requiredHash(hash, `revocation.basisEventHashes[${index}]`)).sort()
      };
    case "rollback.requested":
      return {
        rollbackId: requiredId(payload.rollbackId, "rollback.rollbackId"),
        effectId: requiredId(payload.effectId, "rollback.effectId"),
        rollbackArtifactHash: requiredHash(payload.rollbackArtifactHash, "rollback.rollbackArtifactHash"),
        targetId: requiredId(payload.targetId, "rollback.targetId"),
        idempotencyKey: requiredId(payload.idempotencyKey, "rollback.idempotencyKey"),
        authorityId: requiredId(payload.authorityId, "rollback.authorityId"),
        reason: requiredText(payload.reason, "rollback.reason", 4e3)
      };
    case "rollback.recorded":
      return {
        rollbackId: requiredId(payload.rollbackId, "rollback.rollbackId"),
        status: ["started", "succeeded", "failed"].includes(payload.status) ? payload.status : (() => {
          throw new Error("rollback.status is invalid");
        })(),
        externalReference: requiredText(payload.externalReference, "rollback.externalReference", 2e3),
        observedAt: requiredTimestamp(payload.observedAt, "rollback.observedAt"),
        failureReason: payload.status === "failed" ? requiredText(payload.failureReason, "rollback.failureReason", 2e3) : null
      };
    case "passport.superseded":
      return {
        successorPassportId: requiredId(payload.successorPassportId, "passport.successorPassportId"),
        reason: requiredText(payload.reason, "passport.reason", 4e3)
      };
    default:
      throw new Error(`Unsupported Change Passport event type: ${type}`);
  }
}
var eventHashInput = (event) => {
  const unsigned = cloneJson(event);
  delete unsigned.eventHash;
  delete unsigned.signature;
  return unsigned;
};
async function verifyEventSignature(event, cryptoApi = globalThis.crypto) {
  if (!event?.signature?.publicJwk || !event?.signature?.value) return false;
  try {
    const signerId = await createPeerIdFromPublicJwk(event.signature.publicJwk, cryptoApi);
    if (signerId !== event.signature.signerId) return false;
    const key = await importVerificationKey(event.signature.publicJwk, cryptoApi);
    return cryptoApi.subtle.verify(
      getIdentitySignAlgorithm(event.signature),
      key,
      fromBase64Url(event.signature.value),
      encodeBytes(event.eventHash)
    );
  } catch {
    return false;
  }
}
var eventByHash = (events, hash) => events.find((event) => event.eventHash === hash) || null;
function validateChangePassportTransition(events = [], type, payload, actor = {}) {
  if (!EVENT_TYPE_SET.has(type)) throw new Error(`Unsupported Change Passport event type: ${type}`);
  const normalizedActor = normalizeActor(actor);
  const normalizedPayload = normalizeChangePassportEventPayload(type, payload);
  if (events.length === 0) {
    if (type !== "passport.created") throw new Error("The first event must be passport.created");
    if (normalizedActor.organizationId !== normalizedPayload.organizationId) {
      throw new Error("creator organization does not match the passport organization");
    }
    return { actor: normalizedActor, payload: normalizedPayload };
  }
  if (type === "passport.created") throw new Error("passport.created can occur only once");
  const projection = projectChangePassportEvents(events, {
    valid: true,
    reasons: [],
    eventCount: events.length,
    headHash: events.at(-1)?.eventHash || null,
    validSignatures: events.length
  });
  if (!projection) throw new Error("Passport event history cannot be projected");
  if (projection.supersededBy) throw new Error("A superseded passport is terminal");
  if (normalizedActor.organizationId !== projection.organizationId) {
    throw new Error("actor organization does not match the passport organization");
  }
  if (type === "proposal.recorded") {
    if (projection.decision.state !== "proposed" || projection.evidence.state !== "collecting") {
      throw new Error("proposal can be replaced only before evidence freezes");
    }
    if (normalizedPayload.proposalId !== projection.proposal.proposalId) {
      throw new Error("proposal.recorded cannot replace the frozen proposal identity");
    }
  }
  if (["evidence.admitted", "evidence.excluded"].includes(type) && projection.evidence.state !== "collecting") {
    throw new Error("evidence cannot change after the evidence manifest freezes");
  }
  if (type === "evidence.frozen") {
    if (projection.evidence.state !== "collecting") throw new Error("evidence can freeze only once");
    if (projection.evidence.admitted.length === 0) throw new Error("evidence cannot freeze empty");
    const admittedIds = projection.evidence.admitted.map((item) => item.evidenceId).sort();
    if (canonicalChangePassportJson(admittedIds) !== canonicalChangePassportJson(normalizedPayload.evidenceIds)) {
      throw new Error("evidence freeze IDs do not match admitted evidence");
    }
  }
  if (type === "evaluation.recorded") {
    if (projection.evidence.state !== "frozen") throw new Error("evaluation requires frozen evidence");
    if (normalizedActor.authorityId !== projection.evaluator.authorityId) {
      throw new Error("evaluation actor does not match the frozen evaluator authority");
    }
    for (const [field, expected] of [
      ["evaluatorId", projection.evaluator.evaluatorId],
      ["evaluatorAuthorityId", projection.evaluator.authorityId],
      ["evaluatorHash", projection.evaluator.evaluatorHash],
      ["suiteHash", projection.evaluator.suiteHash],
      ["contractHash", projection.evaluator.contractHash],
      ["baselineHash", projection.proposal.baselineHash],
      ["candidateHash", projection.proposal.candidateHash],
      ["evidenceManifestHash", projection.evidence.manifestHash]
    ]) {
      if (normalizedPayload[field] !== expected) throw new Error(`evaluation ${field} mismatch`);
    }
    if (projection.evaluations.some((entry) => entry.evaluationId === normalizedPayload.evaluationId)) {
      throw new Error("evaluation identity is already recorded");
    }
  }
  if (type === "trigger.declared") {
    const rule = (projection.policy.reopeningRules || []).find((entry) => entry.ruleId === normalizedPayload.ruleId);
    if (!rule) throw new Error("declared trigger is not present in the frozen policy");
    for (const field of [
      "sourceKind",
      "observationKind",
      "targetId",
      "action",
      "sensorAuthorityId",
      "freshnessMilliseconds"
    ]) {
      if (normalizedPayload[field] !== rule[field]) throw new Error(`declared trigger ${field} mismatch`);
    }
    if (canonicalChangePassportJson(normalizedPayload.condition) !== canonicalChangePassportJson(rule.match)) {
      throw new Error("declared trigger condition mismatch");
    }
    if (projection.triggers.declared.some((entry) => entry.ruleId === normalizedPayload.ruleId)) {
      throw new Error("trigger rule is already declared");
    }
  }
  if (type === "decision.recorded") {
    if (projection.evidence.state !== "frozen") throw new Error("decision requires frozen evidence");
    if (normalizedPayload.policyHash !== projection.policy.policyHash) {
      throw new Error("decision policyHash mismatch");
    }
    const evaluationIds = new Set(projection.evaluations.map((entry) => entry.evaluationId));
    if (normalizedPayload.evaluationIds.some((id) => !evaluationIds.has(id))) {
      throw new Error("decision references an unknown evaluation");
    }
    const reviewIds = new Set(projection.reviews.map((entry) => entry.reviewId));
    if (normalizedPayload.reviewIds.some((id) => !reviewIds.has(id))) {
      throw new Error("decision references an unknown review");
    }
  }
  if (type === "effect.requested") {
    if (projection.decision.state !== "approved") throw new Error("effect requires an approved decision");
    if (normalizedPayload.candidateHash !== projection.proposal.candidateHash) {
      throw new Error("effect candidateHash mismatch");
    }
    const decisionEvent = eventByHash(events, normalizedPayload.decisionEventHash);
    if (decisionEvent?.type !== "decision.recorded" || decisionEvent.payload?.state !== "approved") {
      throw new Error("effect must bind the active approved decision event");
    }
    if (projection.effect.requests.some((entry) => entry.effectId === normalizedPayload.effectId)) {
      throw new Error("effect identity is already requested");
    }
  }
  if (type === "effect.recorded") {
    const request = projection.effect.requests.find((entry) => entry.effectId === normalizedPayload.effectId);
    if (!request) throw new Error("effect result requires a matching request");
    if (request.targetId !== normalizedPayload.targetId || request.candidateHash !== normalizedPayload.candidateHash) {
      throw new Error("effect result does not match its request");
    }
  }
  if (type === "trigger.observed") {
    if (!projection.triggers.declared.some((entry) => entry.ruleId === normalizedPayload.ruleId)) {
      throw new Error("observed trigger rule is not declared");
    }
    if (projection.triggers.observed.some((entry) => entry.deduplicationKey === normalizedPayload.deduplicationKey)) {
      throw new Error("trigger observation is a duplicate");
    }
  }
  if (type === "decision.reopened") {
    const trigger = eventByHash(events, normalizedPayload.triggerEventHash);
    if (trigger?.type !== "trigger.observed" || trigger.payload?.ruleId !== normalizedPayload.ruleId) {
      throw new Error("reopening requires the matching observed trigger event");
    }
    if (!["approved", "reopened"].includes(projection.decision.state)) {
      throw new Error("only an approved or reopened decision can reopen");
    }
  }
  if (type === "rollback.requested") {
    if (!["applied", "degraded", "rollback_failed"].includes(projection.effect.state)) {
      throw new Error("rollback requires an applied, degraded, or previously failed rollback effect");
    }
    if (!["reopened", "revoked"].includes(projection.decision.state)) {
      throw new Error("rollback requires a reopened or revoked decision");
    }
    if (normalizedPayload.authorityId !== projection.rollback.authorityId) {
      throw new Error("rollback authority does not match the frozen contract");
    }
    if (normalizedPayload.rollbackArtifactHash !== projection.rollback.artifactHash) {
      throw new Error("rollback artifact does not match the frozen contract");
    }
    if (projection.effect.rollbackRequests.some((entry) => entry.rollbackId === normalizedPayload.rollbackId)) {
      throw new Error("rollback identity is already requested");
    }
  }
  if (type === "rollback.recorded") {
    if (!projection.effect.rollbackRequests.some((entry) => entry.rollbackId === normalizedPayload.rollbackId)) {
      throw new Error("rollback result requires a matching request");
    }
  }
  return { actor: normalizedActor, payload: normalizedPayload };
}
async function verifyChangePassportEvents(events = [], cryptoApi = globalThis.crypto) {
  const reasons = [];
  let previousHash = null;
  let passportId = null;
  let validSignatures = 0;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event?.schema !== CHANGE_PASSPORT_EVENT_SCHEMA) reasons.push(`event ${index} schema mismatch`);
    if (event?.sequence !== index + 1) reasons.push(`event ${index} sequence mismatch`);
    if (event?.previousEventHash !== previousHash) reasons.push(`event ${index} previous hash mismatch`);
    if (index === 0) passportId = event?.passportId || null;
    else if (event?.passportId !== passportId) reasons.push(`event ${index} passportId mismatch`);
    if (!EVENT_TYPE_SET.has(event?.type)) reasons.push(`event ${index} type unsupported`);
    try {
      const expectedHash = await hashChangePassportValue(eventHashInput(event), cryptoApi);
      if (event?.eventHash !== expectedHash) reasons.push(`event ${index} hash mismatch`);
    } catch (error) {
      reasons.push(`event ${index} hash failed: ${error.message}`);
    }
    if (await verifyEventSignature(event, cryptoApi)) validSignatures += 1;
    else reasons.push(`event ${index} signature invalid`);
    try {
      validateChangePassportTransition(events.slice(0, index), event.type, event.payload, event.actor);
    } catch (error) {
      reasons.push(`event ${index} transition invalid: ${error.message}`);
    }
    previousHash = event?.eventHash || null;
  }
  return {
    valid: events.length > 0 && reasons.length === 0,
    eventCount: events.length,
    validSignatures,
    headHash: previousHash,
    passportId,
    reasons
  };
}
function projectChangePassportEvents(events = [], integrity = null) {
  if (events.length === 0 || events[0]?.type !== "passport.created") return null;
  const started = events[0].payload;
  const projection = {
    schema: CHANGE_PASSPORT_SCHEMA,
    passportId: started.passportId,
    organizationId: started.organizationId,
    changeClass: started.changeClass,
    proposal: cloneJson(started.proposal),
    policy: cloneJson(started.policy),
    evaluator: cloneJson(started.evaluator),
    budget: cloneJson(started.budget),
    rollback: cloneJson(started.rollback),
    evidenceCutoff: started.evidenceCutoff,
    createdAt: started.createdAt,
    updatedAt: events[0].timestamp,
    sourceEpisode: cloneJson(started.sourceEpisode),
    evidence: {
      state: "collecting",
      manifestHash: null,
      admitted: [],
      excluded: [],
      invalidations: []
    },
    decision: {
      state: "proposed",
      current: null,
      history: [],
      reopenings: [],
      revocations: []
    },
    effect: {
      state: "not_applied",
      current: null,
      requests: [],
      history: [],
      rollbackRequests: [],
      rollbackHistory: []
    },
    objections: [],
    evaluations: [],
    reviews: [],
    outcomes: [],
    triggers: { declared: [], observed: [] },
    supersededBy: null,
    integrity: integrity || {
      valid: false,
      eventCount: events.length,
      validSignatures: 0,
      headHash: events.at(-1)?.eventHash || null,
      reasons: ["integrity not verified"]
    }
  };
  for (const event of events.slice(1)) {
    const payload = cloneJson(event.payload);
    const withEvent = { ...payload, eventHash: event.eventHash, actor: cloneJson(event.actor) };
    projection.updatedAt = event.timestamp;
    switch (event.type) {
      case "proposal.recorded":
        projection.proposal = payload;
        break;
      case "evidence.admitted":
        projection.evidence.admitted = [
          ...projection.evidence.admitted.filter((entry) => entry.evidenceId !== payload.evidenceId),
          withEvent
        ];
        projection.evidence.state = "collecting";
        projection.evidence.manifestHash = null;
        break;
      case "evidence.excluded":
        projection.evidence.excluded = [
          ...projection.evidence.excluded.filter((entry) => entry.evidenceId !== payload.evidenceId),
          withEvent
        ];
        break;
      case "evidence.frozen":
        projection.evidence.state = "frozen";
        projection.evidence.manifestHash = payload.manifestHash;
        break;
      case "evidence.invalidated":
        projection.evidence.state = "invalidated";
        projection.evidence.invalidations.push(withEvent);
        break;
      case "objection.recorded":
        projection.objections.push(withEvent);
        if (projection.decision.state === "proposed") projection.decision.state = "contested";
        break;
      case "evaluation.recorded":
        projection.evaluations.push(withEvent);
        break;
      case "review.recorded":
        projection.reviews.push(withEvent);
        for (const objectionId of payload.resolvesObjectionIds) {
          const objection = projection.objections.find((entry) => entry.objectionId === objectionId);
          if (objection) objection.resolution = payload.reviewId;
        }
        if (payload.verdict === "contest") projection.decision.state = "contested";
        break;
      case "decision.recorded":
        projection.decision.state = payload.state;
        projection.decision.current = withEvent;
        projection.decision.history.push(withEvent);
        break;
      case "effect.requested":
        projection.effect.requests.push(withEvent);
        break;
      case "effect.recorded":
        projection.effect.history.push(withEvent);
        projection.effect.current = withEvent;
        projection.effect.state = payload.status === "applied" ? "applied" : "not_applied";
        break;
      case "outcome.recorded":
        projection.outcomes.push(withEvent);
        if (payload.status === "degraded" && projection.effect.state === "applied") {
          projection.effect.state = "degraded";
        }
        break;
      case "trigger.declared":
        projection.triggers.declared.push(withEvent);
        break;
      case "trigger.observed":
        projection.triggers.observed.push(withEvent);
        break;
      case "decision.reopened":
        projection.decision.state = "reopened";
        projection.decision.reopenings.push(withEvent);
        break;
      case "decision.revoked":
        projection.decision.state = "revoked";
        projection.decision.revocations.push(withEvent);
        break;
      case "rollback.requested":
        projection.effect.state = "rollback_requested";
        projection.effect.rollbackRequests.push(withEvent);
        break;
      case "rollback.recorded":
        projection.effect.rollbackHistory.push(withEvent);
        if (payload.status === "succeeded") projection.effect.state = "rolled_back";
        if (payload.status === "failed") projection.effect.state = "rollback_failed";
        break;
      case "passport.superseded":
        projection.evidence.state = "superseded";
        projection.supersededBy = payload.successorPassportId;
        break;
      default:
        break;
    }
  }
  projection.evidence.admitted.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  projection.evidence.excluded.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return projection;
}
async function verifyChangePassportExport(exported = {}, options = {}) {
  const reasons = [];
  if (exported.schema !== CHANGE_PASSPORT_EXPORT_SCHEMA) reasons.push("export schema mismatch");
  const unsigned = cloneJson(exported);
  delete unsigned.exportHash;
  try {
    const expectedHash = await hashChangePassportValue(unsigned, options.cryptoApi || globalThis.crypto);
    if (exported.exportHash !== expectedHash) reasons.push("export hash mismatch");
  } catch (error) {
    reasons.push(`export hash failed: ${error.message}`);
  }
  const integrity = await verifyChangePassportEvents(
    Array.isArray(exported.events) ? exported.events : [],
    options.cryptoApi || globalThis.crypto
  );
  reasons.push(...integrity.reasons.map((reason) => `events: ${reason}`));
  const projection = projectChangePassportEvents(exported.events || [], integrity);
  if (!projection) reasons.push("projection cannot be reconstructed");
  else if (canonicalChangePassportJson(projection) !== canonicalChangePassportJson(exported.projection)) {
    reasons.push("exported projection does not match event replay");
  }
  if (projection && canonicalChangePassportJson(projection.policy) !== canonicalChangePassportJson(exported.policy)) {
    reasons.push("exported policy does not match event replay");
  }
  const expectedEvidence = projection?.evidence?.admitted?.map((entry) => ({
    evidenceId: entry.evidenceId,
    kind: entry.kind,
    digest: entry.digest,
    source: entry.source,
    uri: entry.uri,
    custody: cloneJson(entry.custody)
  })) || [];
  if (canonicalChangePassportJson(expectedEvidence) !== canonicalChangePassportJson(exported.evidenceManifest || [])) {
    reasons.push("evidence manifest does not match event replay");
  }
  return {
    valid: reasons.length === 0,
    reasons,
    integrity,
    projection,
    exportHash: exported.exportHash || null
  };
}

// sdk/change-passport/src/index.ts
var ChangePassportHttpError = class extends Error {
  status;
  code;
  body;
  constructor(message, status, body) {
    super(message);
    this.name = "ChangePassportHttpError";
    this.status = status;
    this.code = typeof body === "object" && body && "code" in body ? String(body.code || "") : null;
    this.body = body;
  }
};
var ChangePassportClient = class {
  baseUrl;
  accessToken;
  clientId;
  fetchImpl;
  constructor(options) {
    this.baseUrl = String(options.baseUrl || "").replace(/\/+$/, "");
    if (!this.baseUrl) throw new Error("Change Passport baseUrl is required");
    this.accessToken = options.accessToken ? String(options.accessToken) : null;
    this.clientId = String(options.clientId || "reploid-change-passport-sdk");
    const selectedFetch = options.fetchImpl || globalThis.fetch;
    if (typeof selectedFetch !== "function") throw new Error("fetch is unavailable");
    this.fetchImpl = selectedFetch.bind(globalThis);
  }
  async request(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("Accept", "application/json");
    headers.set("X-Reploid-Client-Id", this.clientId);
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const raw = await response.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = { raw };
    }
    if (!response.ok) {
      const message = typeof body === "object" && body && "error" in body ? String(body.error) : `Change Passport request failed with ${response.status}`;
      throw new ChangePassportHttpError(message, response.status, body);
    }
    return body;
  }
  writeHeaders(idempotencyKey) {
    if (!idempotencyKey) throw new Error("idempotencyKey is required");
    return { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey };
  }
  async createPassport(payload, options) {
    return this.request("/passports", {
      method: "POST",
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }
  async listPassports() {
    const result = await this.request("/passports");
    return result.passports;
  }
  async getPrincipal() {
    return this.request("/principal");
  }
  async getPassport(passportId) {
    return this.request(`/passports/${encodeURIComponent(passportId)}`);
  }
  async getEvents(passportId) {
    const result = await this.request(
      `/passports/${encodeURIComponent(passportId)}/events`
    );
    return result.events;
  }
  async appendEvent(passportId, type, payload, options) {
    return this.request(`/passports/${encodeURIComponent(passportId)}/events`, {
      method: "POST",
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ type, payload, role: options.role })
    });
  }
  async submitEvidence(passportId, payload, options) {
    return this.appendEvent(passportId, "evidence.admitted", payload, options);
  }
  async excludeEvidence(passportId, payload, options) {
    return this.appendEvent(passportId, "evidence.excluded", payload, options);
  }
  async recordObjection(passportId, payload, options) {
    return this.appendEvent(passportId, "objection.recorded", payload, options);
  }
  async submitEvaluation(passportId, payload, options) {
    return this.appendEvent(passportId, "evaluation.recorded", payload, options);
  }
  async recordReview(passportId, payload, options) {
    return this.appendEvent(passportId, "review.recorded", payload, options);
  }
  async requestDecision(passportId, payload, options) {
    return this.appendEvent(passportId, "decision.recorded", payload, options);
  }
  async recordEffect(passportId, payload, options) {
    return this.appendEvent(passportId, "effect.recorded", payload, options);
  }
  async recordOutcome(passportId, payload, options) {
    return this.appendEvent(passportId, "outcome.recorded", payload, options);
  }
  async observeTrigger(passportId, payload, options) {
    return this.request(`/passports/${encodeURIComponent(passportId)}/triggers`, {
      method: "POST",
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }
  async observeStandardTrigger(passportId, input, options) {
    return this.request(`/passports/${encodeURIComponent(passportId)}/triggers/standard`, {
      method: "POST",
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ ...input, role: options.role })
    });
  }
  async requestRollback(passportId, payload, options) {
    return this.appendEvent(passportId, "rollback.requested", payload, options);
  }
  async executeEffect(passportId, payload, options) {
    return this.request(`/passports/${encodeURIComponent(passportId)}/effects/execute`, {
      method: "POST",
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }
  async executeRollback(passportId, payload, options) {
    return this.request(`/passports/${encodeURIComponent(passportId)}/rollbacks/execute`, {
      method: "POST",
      headers: this.writeHeaders(options.idempotencyKey),
      body: JSON.stringify({ payload, role: options.role })
    });
  }
  async exportPassport(passportId) {
    return this.request(`/passports/${encodeURIComponent(passportId)}/export`);
  }
  async verifyPassport(exported) {
    return verifyChangePassportExport(exported);
  }
};
var index_default = ChangePassportClient;
export {
  ChangePassportClient,
  ChangePassportHttpError,
  index_default as default
};
