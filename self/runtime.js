/**
 * @fileoverview Dedicated Reploid self runtime.
 */

import Utils from './core/utils.js';
import ResponseParser from './core/response-parser.js';
import { createSelfBridge } from './bridge.js';
import { DREAM_INSTANCE_MANIFEST_PATH, getDreamInstanceSeedSummary } from './dream-instance.js';
import { getCurrentReploidInstanceId } from './instance.js';
import { SELF_BLUEPRINT_PATHS, SELF_PROMPT_PATHS } from './manifest.js';

const MAX_CYCLES = 2048;
const MAX_BATCH_TOOLS = 5;
const SINGLE_TOOL_NUDGE_THRESHOLD = 3;
const MILESTONE_AUTOPARK_THRESHOLD = 3;
const RGR_ARCHIVE_LIMIT = 24;
const PARALLEL_SAFE_TOOLS = new Set([
  'ReadFile',
  'ListFiles',
  'Search',
  'Grep',
  'Find',
  'Head',
  'Tail',
  'FileOutline',
  'ListTools',
  'ListWorkers',
  'SwarmGetStatus',
  'InspectStatus'
]);
const ORDERED_TOOLS = new Set([
  'WriteFile',
  'CreateTool',
  'LoadModule',
  'EditFile',
  'DeleteFile',
  'RunGEPA',
  'SwarmShareFile',
  'SwarmRequestFile',
  'SpawnWorker',
  'AwaitWorkers'
]);
const EXCLUSIVE_TOOLS = new Set([
  'Promote',
  'PromoteCandidate',
  'UpdateValidator',
  'WriteLedger',
  'AnchorGate'
]);
const BOOTSTRAP_CONTEXT_PATHS = Object.freeze([
  ...SELF_PROMPT_PATHS,
  ...SELF_BLUEPRINT_PATHS
]);
const RGR_SLOT_ROLES = Object.freeze([
  'elite',
  'performance',
  'robustness',
  'repair',
  'low-cost',
  'safety',
  'fallback'
]);
const REQUIRED_ANCHOR_OBSERVATIONS = 3;
const RGR_SCORE_KEYS = Object.freeze([
  'usefulness',
  'safety',
  'reversibility',
  'evidence',
  'qAnchor',
  'efficiency'
]);

const estimateTokens = (text) => {
  const value = String(text || '');
  return Math.max(0, Math.ceil(value.length / 4));
};

const formatToolResult = (name, result, kind = 'RESULT') => {
  const payload = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  return `[TOOL ${name} ${kind}]\n${payload}`.trim();
};

const normalizeToolName = (name) => String(name || '').trim();

const normalizePlanId = (id) => String(id || '').trim();

const normalizePlanDeps = (after) => {
  if (after === undefined || after === null || after === '') return [];
  if (Array.isArray(after)) {
    return after.map((item) => normalizePlanId(item)).filter(Boolean);
  }
  return String(after)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getToolExecutionMode = (call = {}) => {
  const name = normalizeToolName(call.name);
  if (!name || call.error) return 'ordered';
  if (PARALLEL_SAFE_TOOLS.has(name)) return 'parallel';
  if (EXCLUSIVE_TOOLS.has(name)) return 'exclusive';
  if (ORDERED_TOOLS.has(name)) return 'ordered';
  return 'ordered';
};

const groupToolCallsInOrder = (calls = []) => {
  const groups = [];
  let parallelCalls = [];

  const flushParallel = () => {
    if (parallelCalls.length === 0) return;
    groups.push({
      mode: 'parallel',
      calls: parallelCalls
    });
    parallelCalls = [];
  };

  for (const call of calls) {
    const mode = getToolExecutionMode(call);
    if (mode === 'parallel') {
      parallelCalls.push(call);
      continue;
    }

    flushParallel();
    groups.push({
      mode,
      calls: [call]
    });
  }

  flushParallel();
  return groups;
};

const buildDependencyExecutionGroups = (calls = []) => {
  const prepared = calls.map((call, index) => ({
    ...call,
    id: normalizePlanId(call.id),
    after: normalizePlanDeps(call.after),
    index
  }));
  const idCounts = new Map();

  for (const call of prepared) {
    if (!call.id) continue;
    idCounts.set(call.id, (idCounts.get(call.id) || 0) + 1);
  }

  const knownIds = new Set(
    [...idCounts.entries()]
      .filter(([, count]) => count === 1)
      .map(([id]) => id)
  );
  let pending = prepared.map((call) => {
    if (call.id && idCounts.get(call.id) > 1) {
      return {
        ...call,
        error: call.error || `Duplicate PLAN step id: ${call.id}`
      };
    }
    return call;
  });
  const completed = new Set();
  const groups = [];

  while (pending.length > 0) {
    const ready = [];
    const blocked = [];

    for (const call of pending) {
      const missingDeps = call.after.filter((id) => !knownIds.has(id));
      if (missingDeps.length > 0) {
        ready.push({
          ...call,
          error: call.error || `Unknown PLAN dependency: ${missingDeps.join(', ')}`
        });
        continue;
      }

      const unresolvedDeps = call.after.filter((id) => !completed.has(id));
      if (unresolvedDeps.length === 0) {
        ready.push(call);
      } else {
        blocked.push(call);
      }
    }

    if (ready.length === 0) {
      groups.push(...groupToolCallsInOrder(
        blocked.map((call) => ({
          ...call,
          error: call.error || `Unresolved PLAN dependency cycle: ${call.after.join(', ')}`
        }))
      ));
      break;
    }

    groups.push(...groupToolCallsInOrder(ready));
    for (const call of ready) {
      if (call.id) completed.add(call.id);
    }
    pending = blocked;
  }

  return groups;
};

const buildToolExecutionGroups = (calls = []) => {
  const hasPlanScheduling = calls.some((call) =>
    normalizePlanId(call.id) || normalizePlanDeps(call.after).length > 0
  );
  if (hasPlanScheduling) return buildDependencyExecutionGroups(calls);
  return groupToolCallsInOrder(calls);
};

const getToolBatchMode = (groups = []) => {
  const parallelGroups = groups.filter((group) => group.mode === 'parallel').length;
  if (parallelGroups === groups.length) return 'parallel-read';
  if (parallelGroups > 0) return 'scheduled';
  return 'ordered';
};

const formatToolBatchResult = (entries = [], groups = []) => {
  const errors = entries.filter((entry) => entry.kind === 'ERROR').length;
  const tools = entries
    .map((entry) => {
      const name = normalizeToolName(entry.call?.name) || 'unknown';
      const id = normalizePlanId(entry.call?.id);
      return id ? `${id}:${name}` : name;
    })
    .join(', ');
  const parallelGroups = groups.filter((group) => group.mode === 'parallel').length;
  const body = entries
    .map((entry) => entry.message)
    .filter(Boolean)
    .join('\n\n');

  return [
    '[TOOL BATCH RESULT]',
    `mode: ${getToolBatchMode(groups)}`,
    `groups: ${groups.length}`,
    `parallelGroups: ${parallelGroups}`,
    `count: ${entries.length}`,
    `errors: ${errors}`,
    `tools: ${tools}`,
    '',
    body
  ].join('\n').trim();
};

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

const stableStringify = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
};

const hashString = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const getToolPath = (call = {}) => {
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const rawPath = args.path || args.target || args.file || args.outputPath || '';
  return typeof rawPath === 'string' ? rawPath.trim() : '';
};

const getCandidateKind = (entries = []) => {
  const paths = entries.map((entry) => getToolPath(entry.call)).filter(Boolean);
  const mutationPaths = entries
    .filter((entry) => getToolExecutionMode(entry.call) !== 'parallel')
    .map((entry) => getToolPath(entry.call))
    .filter(Boolean);
  if (mutationPaths.some((path) => path.startsWith('/artifacts/rgr/') || path.startsWith('opfs:/artifacts/rgr/'))) return 'rgr-artifact';
  if (mutationPaths.some((path) => path.startsWith('/artifacts/dream/') || path.startsWith('opfs:/artifacts/dream/'))) return 'dream-artifact';
  if (mutationPaths.some((path) => path.startsWith('/self/prompts/'))) return 'prompt-candidate';
  if (mutationPaths.some((path) => path.startsWith('/self/blueprints/'))) return 'blueprint-candidate';
  if (mutationPaths.some((path) => path.startsWith('/self/tools/'))) return 'tool-candidate';
  if (mutationPaths.some((path) => path.startsWith('/self/'))) return 'self-candidate';
  if (entries.some((entry) => getToolExecutionMode(entry.call) === 'parallel')) return 'read-evidence';
  if (paths.some((path) => path.startsWith('/artifacts/rgr/') || path.startsWith('opfs:/artifacts/rgr/'))) return 'rgr-artifact';
  return 'shadow-candidate';
};

const summarizeToolEntries = (entries = []) => {
  const tools = entries.map((entry) => normalizeToolName(entry.call?.name) || 'unknown');
  const paths = entries.map((entry) => getToolPath(entry.call)).filter(Boolean);
  const errors = entries.filter((entry) => entry.kind === 'ERROR').length;
  const successful = Math.max(0, entries.length - errors);
  const readOnly = entries.filter((entry) => getToolExecutionMode(entry.call) === 'parallel').length;
  const ordered = entries.filter((entry) => getToolExecutionMode(entry.call) === 'ordered').length;
  const exclusive = entries.filter((entry) => getToolExecutionMode(entry.call) === 'exclusive').length;
  return {
    tools,
    paths,
    count: entries.length,
    successful,
    errors,
    readOnly,
    ordered,
    exclusive,
    kind: getCandidateKind(entries)
  };
};

const scoreRgrCandidate = ({ entries = [], groups = [], anchorObservations = 0 }) => {
  const summary = summarizeToolEntries(entries);
  const total = Math.max(1, summary.count);
  const mutationCount = summary.ordered + summary.exclusive;
  const selfPathWrites = entries.filter((entry) => {
    const name = normalizeToolName(entry.call?.name);
    const path = getToolPath(entry.call);
    return ['WriteFile', 'EditFile', 'CreateTool', 'LoadModule'].includes(name) && path.startsWith('/self/');
  }).length;
  const artifactWrites = entries.filter((entry) => {
    const name = normalizeToolName(entry.call?.name);
    const path = getToolPath(entry.call);
    return ['WriteFile', 'EditFile'].includes(name) && (
      path.startsWith('/artifacts/') ||
      path.startsWith('opfs:/artifacts/')
    );
  }).length;
  const parallelGroups = groups.filter((group) => group.mode === 'parallel').length;
  const score = {
    usefulness: clamp01((summary.successful + artifactWrites + parallelGroups) / (total + 2)),
    safety: clamp01(1 - ((summary.errors * 0.35) + (summary.exclusive * 0.45) + (selfPathWrites * 0.18))),
    reversibility: clamp01(1 - ((selfPathWrites * 0.22) + (summary.exclusive * 0.35)) + (artifactWrites * 0.12)),
    evidence: clamp01((summary.readOnly + artifactWrites) / (total + 1)),
    qAnchor: clamp01(anchorObservations / REQUIRED_ANCHOR_OBSERVATIONS),
    efficiency: clamp01(1 - ((total - 1) / (MAX_BATCH_TOOLS * 2)))
  };
  return Object.fromEntries(
    Object.entries(score).map(([key, value]) => [key, Number(value.toFixed(3))])
  );
};

const normalizeAnchorObservation = (observation = {}) => {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    return null;
  }
  const verified = observation.verified === true || observation.valid === true;
  if (!verified) return null;
  const id = String(
    observation.id ||
    observation.receiptId ||
    observation.path ||
    observation.provider ||
    ''
  ).trim();
  if (!id) return null;
  return Object.freeze({
    id,
    receiptId: observation.receiptId || id,
    provider: observation.provider || null,
    consumer: observation.consumer || null,
    jobHash: observation.jobHash || null,
    model: observation.model || null,
    timestamp: Number(observation.timestamp || 0) || null,
    path: observation.path || null,
    verified: true
  });
};

const normalizeAnchorObservations = (observations = []) => {
  const seen = new Set();
  const normalized = [];
  for (const observation of Array.isArray(observations) ? observations : []) {
    const next = normalizeAnchorObservation(observation);
    if (!next || seen.has(next.id)) continue;
    seen.add(next.id);
    normalized.push(next);
  }
  return normalized;
};

const buildRgrCandidateIdentity = ({
  cycle,
  instanceId,
  candidateText,
  summary,
  parentId
}) => {
  const digest = hashString(stableStringify({
    cycle,
    instanceId,
    candidateText,
    summary,
    parentId
  }));
  return {
    digest,
    id: `rgr-shadow-${cycle}-${digest}`
  };
};

const isDominatedBy = (candidateScore = {}, archiveEntry = {}) => {
  const otherScore = archiveEntry.score || {};
  const noWorse = RGR_SCORE_KEYS.every((key) => (
    Number(otherScore[key] || 0) >= Number(candidateScore[key] || 0)
  ));
  const betterSomewhere = RGR_SCORE_KEYS.some((key) => (
    Number(otherScore[key] || 0) > Number(candidateScore[key] || 0)
  ));
  return noWorse && betterSomewhere;
};

const evaluatePromotionGate = ({ score, summary, pareto }) => {
  const reasons = [];
  if (summary.errors > 0) {
    reasons.push(`${summary.errors} tool error${summary.errors === 1 ? '' : 's'} present`);
  }
  if (summary.exclusive > 0) {
    reasons.push('exclusive gate/tool request requires independent governance');
  }
  if (score.qAnchor < 1) {
    reasons.push(`missing independent anchor observations (${Math.round(score.qAnchor * REQUIRED_ANCHOR_OBSERVATIONS)}/${REQUIRED_ANCHOR_OBSERVATIONS})`);
  }
  if (!pareto.survives) {
    reasons.push('candidate is Pareto-dominated by the Shadow archive');
  }

  const hardReject = summary.errors > 0 || summary.exclusive > 0 || !pareto.survives;
  return {
    state: hardReject ? 'rejected' : (reasons.length > 0 ? 'pending-anchors' : 'passed'),
    reasons
  };
};

const buildRgrArchiveEntry = ({
  cycle,
  instanceId,
  candidateText,
  entries,
  groups,
  parentId,
  archive,
  anchorObservations = []
}) => {
  const summary = summarizeToolEntries(entries);
  const verifiedAnchorObservations = normalizeAnchorObservations(anchorObservations);
  const score = scoreRgrCandidate({
    entries,
    groups,
    anchorObservations: verifiedAnchorObservations.length
  });
  const { digest, id } = buildRgrCandidateIdentity({
    cycle,
    instanceId,
    candidateText,
    summary,
    parentId
  });
  const pareto = {
    survives: !archive.some((entry) => isDominatedBy(score, entry)),
    comparedAgainst: archive.length,
    keys: [...RGR_SCORE_KEYS]
  };
  const gate = evaluatePromotionGate({ score, summary, pareto });

  return {
    version: 1,
    id,
    state: 'shadow',
    phase: 'candidate-ring',
    cycle,
    instanceId,
    parentId: parentId || 'seed',
    kind: summary.kind,
    scheduler: {
      mode: getToolBatchMode(groups),
      groups: groups.length,
      parallelGroups: groups.filter((group) => group.mode === 'parallel').length
    },
    summary,
    score,
    pareto,
    gate,
    anchor: {
      required: REQUIRED_ANCHOR_OBSERVATIONS,
      observations: verifiedAnchorObservations,
      qAnchor: score.qAnchor
    },
    validator: {
      state: 'quarantined',
      selfApprovalAllowed: false
    },
    promotion: {
      allowed: gate.state === 'passed',
      boundary: 'Promote is disabled until anchored replay evidence passes.'
    },
    digest
  };
};

const extractPrefixedLine = (text, prefixes) => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    for (const prefix of prefixes) {
      const marker = `${prefix.toUpperCase()}:`;
      if (line.toUpperCase().startsWith(marker)) {
        return line.slice(marker.length).trim();
      }
    }
  }

  return null;
};

const getMessageLabel = (message = {}) => {
  const origin = String(message.origin || '').toLowerCase();
  if (origin === 'bootstrap') return 'BOOT';
  if (origin === 'model') return 'MODEL';
  if (origin === 'tool') return 'TOOL';
  if (origin === 'system') return 'SYSTEM';
  return String(message.role || 'unknown').toUpperCase();
};

const formatContextMessage = (message = {}) => {
  const content = String(message.content || '').trim();
  const label = getMessageLabel(message);
  if (!content) {
    return `[${label}]`;
  }

  // Tool and system observations already carry a structured prefix that is useful
  // both to the model and to the human transcript.
  if (content.startsWith('[TOOL ') || content.startsWith('[SYSTEM')) {
    return content;
  }

  return `[${label}]\n${content}`.trim();
};

const parseSelfDirective = (responseParser, text) => {
  const cleaned = String(text || '').trim();
  if (!cleaned) return null;

  const calls = responseParser.parseToolCalls(cleaned).map((call) => ({
    name: String(call?.name || '').trim(),
    args: call?.args && typeof call.args === 'object' ? call.args : {},
    id: normalizePlanId(call?.id),
    after: normalizePlanDeps(call?.after),
    error: call?.error || null
  })).filter((call) => call.name);

  const milestoneReason = extractPrefixedLine(cleaned, ['MILESTONE', 'DONE']);
  const idleReason = extractPrefixedLine(cleaned, ['IDLE', 'PARK']);

  if (calls.length > 0) {
    return {
      type: 'tools',
      calls,
      milestoneReason,
      idleReason
    };
  }

  if (idleReason !== null) {
    return {
      type: 'idle',
      reason: idleReason,
      wakeOn: 'manual'
    };
  }

  if (milestoneReason !== null) {
    return {
      type: 'done',
      reason: milestoneReason
    };
  }

  return null;
};

const buildSystemNotice = (message) => `[SYSTEM]\n${String(message || '').trim()}`.trim();
const withTerminalPunctuation = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
};
const buildMilestoneNotice = (reason) => buildSystemNotice(
  reason
    ? `Milestone recorded: ${withTerminalPunctuation(reason)} Policy unchanged: execution remains resumable until you stop it or the cycle limit is reached.`
    : 'Milestone recorded. Policy unchanged: execution remains resumable until you stop it or the cycle limit is reached.'
);
const buildParkNotice = (reason, wakeOn = 'manual') => buildSystemNotice(
  reason
    ? `Waiting: ${withTerminalPunctuation(reason)} Resume when new work is available. Wake condition: ${wakeOn}.`
    : `Waiting. Resume when new work is available. Wake condition: ${wakeOn}.`
);

export function createSelfRuntime(options = {}) {
  const goal = String(options.goal || '').trim();
  const environment = String(options.environment || '').trim();
  const swarmEnabled = !!options.swarmEnabled;
  const instanceId = String(options.instanceId || getCurrentReploidInstanceId() || 'default');
  const bridge = createSelfBridge({
    instanceId,
    modelConfig: options.modelConfig || null,
    swarmEnabled,
    seedOverrides: options.seedOverrides || {},
    forceFreshIdentity: !!options.forceFreshIdentity
  });
  const runtimeUtils = Utils.factory();
  const responseParser = ResponseParser.factory({ Utils: runtimeUtils });
  const listeners = new Set();
  const dreamInstance = getDreamInstanceSeedSummary();

  let running = false;
  let stopped = false;
  let cycle = 0;
  let activity = 'Awaiting goal';
  let status = 'IDLE';
  let tokenUsage = 0;
  let draft = '';
  let messages = [];
  let parked = false;
  let wakeOn = 'manual';
  let consecutiveSingleToolCycles = 0;
  let consecutiveMilestoneOnlyCycles = 0;
  let lastMilestoneReason = '';
  let repeatedMilestoneCount = 0;
  let candidateCount = 0;
  let toolCallCount = 0;
  let errorCount = 0;
  let rgrArchive = [];
  let latestRgrReceiptPath = '';

  if (typeof bridge.on === 'function') {
    bridge.on('provider-ready', () => {
      if (!(parked && wakeOn === 'provider-ready' && !running && !stopped)) {
        return;
      }

      const notice = buildSystemNotice('Remote host slot discovered. Resuming generation.');
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parked = false;
      wakeOn = 'manual';
      status = 'IDLE';
      activity = 'Provider discovered';
      notify();
      start().catch(() => {});
    });

    bridge.on('swarm-state', () => {
      notify();
    });
  }

  const notify = () => {
    const snapshot = getSnapshot();
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // Ignore listener errors
      }
    });
  };

  const appendMessage = (role, content, origin = null) => {
    messages.push({
      role,
      content: String(content || ''),
      origin: origin || (role === 'assistant' ? 'model' : 'observation')
    });
  };

  const persistRgrArchiveEntry = async (entry) => {
    const receiptPath = `/artifacts/rgr/${entry.id}.json`;
    const nextEntry = {
      ...entry,
      receiptPath,
      persisted: false
    };

    if (typeof bridge.writeRuntimeArtifact !== 'function') {
      return nextEntry;
    }

    try {
      const persistedEntry = {
        ...nextEntry,
        persisted: true
      };
      await bridge.writeRuntimeArtifact(receiptPath, JSON.stringify(persistedEntry, null, 2));
      return persistedEntry;
    } catch (error) {
      return {
        ...nextEntry,
        persistenceError: error?.message || String(error)
      };
    }
  };

  const recordRgrArchiveEntry = async ({ candidateText, entries, groups }) => {
    if (!entries.length) return null;
    const summary = summarizeToolEntries(entries);
    const parentId = rgrArchive[0]?.id || 'seed';
    const identity = buildRgrCandidateIdentity({
      cycle,
      instanceId,
      candidateText,
      summary,
      parentId
    });
    const anchorObservations = typeof bridge.getAnchorObservations === 'function'
      ? await bridge.getAnchorObservations({
          candidateId: identity.id,
          digest: identity.digest,
          parentId,
          cycle,
          instanceId,
          summary
        })
      : [];
    let entry = buildRgrArchiveEntry({
      cycle,
      instanceId,
      candidateText,
      entries,
      groups,
      parentId,
      archive: rgrArchive,
      anchorObservations
    });
    entry = await persistRgrArchiveEntry(entry);
    latestRgrReceiptPath = entry.receiptPath || latestRgrReceiptPath;
    rgrArchive = [entry, ...rgrArchive].slice(0, RGR_ARCHIVE_LIMIT);
    return entry;
  };

  const refreshRgrArchiveAnchors = async () => {
    if (!rgrArchive.length || typeof bridge.getAnchorObservations !== 'function') {
      return false;
    }

    const rescored = [];
    let changed = false;
    for (const entry of rgrArchive) {
      const anchorObservations = normalizeAnchorObservations(
        await bridge.getAnchorObservations({
          candidateId: entry.id,
          digest: entry.digest,
          parentId: entry.parentId,
          cycle: entry.cycle,
          instanceId: entry.instanceId,
          summary: entry.summary,
          lineage: [entry.id, entry.parentId].filter(Boolean)
        })
      );
      const qAnchor = Number(clamp01(anchorObservations.length / REQUIRED_ANCHOR_OBSERVATIONS).toFixed(3));
      const priorAnchors = entry.anchor?.observations || [];
      if (
        qAnchor !== Number(entry.score?.qAnchor || 0) ||
        anchorObservations.length !== priorAnchors.length
      ) {
        changed = true;
      }
      rescored.push({
        ...entry,
        score: {
          ...(entry.score || {}),
          qAnchor
        },
        anchor: {
          ...(entry.anchor || {}),
          required: REQUIRED_ANCHOR_OBSERVATIONS,
          observations: anchorObservations,
          qAnchor
        }
      });
    }

    const replayed = rescored.map((entry) => {
      const pareto = {
        survives: !rescored.some((other) => other !== entry && isDominatedBy(entry.score, other)),
        comparedAgainst: Math.max(0, rescored.length - 1),
        keys: [...RGR_SCORE_KEYS]
      };
      const gate = evaluatePromotionGate({
        score: entry.score,
        summary: entry.summary,
        pareto
      });
      return {
        ...entry,
        pareto,
        gate,
        promotion: {
          ...(entry.promotion || {}),
          allowed: gate.state === 'passed'
        }
      };
    });

    rgrArchive = replayed;
    return changed;
  };

  const seedContext = async () => {
    const files = await bridge.seedSystemFiles({
      goal,
      environment,
      swarmEnabled
    });
    const contextFiles = typeof bridge.readBootstrapFiles === 'function'
      ? await bridge.readBootstrapFiles(BOOTSTRAP_CONTEXT_PATHS)
      : {};
    const renderedContextFiles = Object.entries(contextFiles)
      .map(([path, content]) => `${path}:\n${content}`)
      .join('\n\n');
    messages = [
      {
        role: 'user',
        origin: 'bootstrap',
        content: [
          `Self:\n${files['/self/self.json']}`,
          renderedContextFiles ? `Bootstrap context:\n${renderedContextFiles}` : ''
        ].filter(Boolean).join('\n\n')
      }
    ];
  };

  const getRenderedBlocks = () => {
    const blocks = [...messages].reverse().map(formatContextMessage);
    if (draft.trim()) {
      blocks.unshift(`[MODEL]\n${draft}`.trim());
    }
    return blocks;
  };

  // Keep the runtime state machine unchanged, but expose clearer UI semantics.
  const getDisplayRunState = () => {
    if (running) return 'RUNNING';
    if (status === 'ERROR') return 'FAILED';
    if (status === 'LIMIT') return 'HALTED_AT_CYCLE_LIMIT';
    if (parked) {
      return wakeOn === 'provider-ready' ? 'WAITING_ON_PROVIDER' : 'WAITING';
    }
    if (stopped) return 'PAUSED_BY_USER';
    if (cycle > 0 && status === 'IDLE') return 'READY_TO_CONTINUE';
    return 'READY';
  };

  const getDisplayPolicy = () => {
    if (parked && wakeOn === 'provider-ready') return 'auto-resume on provider-ready';
    if (status === 'ERROR') return 'manual restart required';
    if (status === 'LIMIT') return 'cycle limit reached';
    if (stopped) return 'manual resume required';
    if (running || (cycle > 0 && status === 'IDLE')) return 'auto-continue enabled';
    return 'manual start required';
  };

  const getRgrMode = () => {
    if (cycle <= 0 && messages.length <= 1 && !running && !parked) return 'seed';
    return 'shadow';
  };

  const getSlotState = ({ mode, slot, placement, gateState }) => {
    if (placement === 'empty') return 'empty';
    if (gateState === 'blocked') return 'blocked';
    if (placement === 'remote' && slot.waitingForHost) return 'pending host';
    if (mode === 'seed') return placement === 'local' ? 'ready' : 'pending';
    if (slot.id === 'elite') return running ? 'running' : 'archived';
    if (slot.id === 'performance') return running ? 'scoring' : 'idle';
    if (slot.id === 'robustness') return running ? 'replay' : 'idle';
    if (slot.id === 'repair') return parked || status === 'ERROR' ? 'repairing' : 'archived';
    if (slot.id === 'safety') return running ? 'validating' : 'idle';
    if (slot.id === 'fallback') return 'archived';
    return 'idle';
  };

  const buildRgrSlots = ({ hasLocalHost, effectiveSwarmEnabled, swarm, mode, gateState }) => {
    const peerCount = Math.max(0, Number(swarm?.peerCount || 0));
    const providerCount = Math.max(0, Number(swarm?.providerCount || 0));
    const remoteAvailable = effectiveSwarmEnabled && peerCount > 0;
    const waitingForHost = effectiveSwarmEnabled && !hasLocalHost && providerCount === 0;
    const remotePreferred = new Set(['performance', 'robustness', 'safety']);

    return RGR_SLOT_ROLES.map((id) => {
      let placement = 'empty';
      if (hasLocalHost) {
        placement = remoteAvailable && remotePreferred.has(id) ? 'remote' : 'local';
      } else if (effectiveSwarmEnabled) {
        placement = 'remote';
      }

      const slot = { id, waitingForHost };
      return {
        id,
        placement,
        state: getSlotState({ mode, slot, placement, gateState })
      };
    });
  };

  const getRgrSnapshot = (swarm) => {
    const hasLocalHost = !!bridge.getModelConfig();
    const effectiveSwarmEnabled = !!(swarm?.enabled || swarmEnabled);
    const mode = getRgrMode();
    const latestArchive = rgrArchive[0] || null;
    const anchorObservations = latestArchive?.anchor?.observations?.length || 0;
    const gateState = parked && wakeOn === 'provider-ready'
      ? 'blocked'
      : status === 'ERROR'
        ? 'rejected'
        : latestArchive?.gate?.state || (
            anchorObservations >= REQUIRED_ANCHOR_OBSERVATIONS
              ? 'passed'
              : 'pending-anchors'
          );
    const gateReasons = parked && wakeOn === 'provider-ready'
      ? ['waiting for remote host slot']
      : latestArchive?.gate?.reasons || [];
    const role = effectiveSwarmEnabled
      ? (hasLocalHost ? 'provider' : 'consumer')
      : (hasLocalHost ? 'solo' : 'dead');
    const slotMode = hasLocalHost && effectiveSwarmEnabled
      ? 'local/remote'
      : hasLocalHost
        ? 'local'
        : effectiveSwarmEnabled
          ? 'remote'
          : 'empty';
    const hostStatus = hasLocalHost
      ? (effectiveSwarmEnabled ? 'hosting local slots' : 'local only')
      : (effectiveSwarmEnabled ? 'waiting for host' : 'none');

    return {
      name: 'Recursive GEPA Ring',
      mode,
      stage: getDisplayRunState(),
      topology: effectiveSwarmEnabled ? 'peer-assisted' : 'local',
      role,
      slotMode,
      slots: buildRgrSlots({
        hasLocalHost,
        effectiveSwarmEnabled,
        swarm,
        mode,
        gateState
      }),
      gate: {
        state: gateState,
        anchors: anchorObservations,
        required: REQUIRED_ANCHOR_OBSERVATIONS,
        reasons: gateReasons
      },
      counters: {
        candidates: candidateCount,
        toolCalls: toolCallCount,
        errors: errorCount,
        tokens: tokenUsage,
        archive: rgrArchive.length,
        replay: rgrArchive.length,
        receipts: rgrArchive.length
      },
      archive: {
        count: rgrArchive.length,
        limit: RGR_ARCHIVE_LIMIT,
        latest: latestArchive,
        frontier: rgrArchive
          .filter((entry) => entry.pareto?.survives)
          .slice(0, 5)
          .map((entry) => ({
            id: entry.id,
            kind: entry.kind,
            score: entry.score,
            gate: entry.gate,
            receiptPath: entry.receiptPath
          }))
      },
      receipts: {
        count: rgrArchive.length,
        latestPath: latestRgrReceiptPath || null
      },
      hostStatus,
      promotionGate: 'anchor',
      validator: 'quarantined',
      anchor: 'version-frozen',
      instances: [
        {
          id: dreamInstance.id,
          kind: dreamInstance.kind,
          state: dreamInstance.state,
          mode: dreamInstance.mode,
          manifestPath: DREAM_INSTANCE_MANIFEST_PATH,
          gate: dreamInstance.gate
        }
      ],
      peerCount: swarm?.peerCount || 0,
      providerCount: swarm?.providerCount || 0,
      consumerCount: swarm?.consumerCount || 0,
      transport: swarm?.transport || null,
      connectionState: swarm?.connectionState || 'disconnected'
    };
  };

  const getSnapshot = () => {
    const swarm = typeof bridge.getSwarmSnapshot === 'function' ? bridge.getSwarmSnapshot() : null;
    return {
      running,
      stopped,
      status,
      activity,
      parked,
      wakeOn,
      cycle,
      instanceId,
      goal,
      model: bridge.getModelLabel(),
      tokens: {
        used: tokenUsage,
        limit: 0
      },
      context: [...messages],
      draft,
      swarm,
      rgr: getRgrSnapshot(swarm),
      ecosystem: {
        instances: [
          {
            ...dreamInstance,
            manifestPath: DREAM_INSTANCE_MANIFEST_PATH
          }
        ]
      },
      display: {
        runState: getDisplayRunState(),
        policy: getDisplayPolicy()
      },
      renderedBlocks: getRenderedBlocks(),
      renderedText: getRenderedBlocks().join('\n\n').trim()
    };
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    listener(getSnapshot());
    return () => listeners.delete(listener);
  };

  const stop = () => {
    stopped = true;
    running = false;
    parked = false;
    wakeOn = 'manual';
    status = 'IDLE';
    activity = 'Stopped by user';
    draft = '';
    notify();
  };

  const parkRuntime = (reason = '', nextWakeOn = 'manual') => {
    parked = true;
    wakeOn = nextWakeOn || 'manual';
    running = false;
    stopped = false;
    status = 'PARKED';
    activity = reason ? `Parked: ${reason}` : 'Parked';
    draft = '';
    notify();
  };

  const start = async () => {
    if (running) return;
    if (!goal) {
      activity = 'Missing goal';
      notify();
      return;
    }

    if (messages.length === 0) {
      if (typeof bridge.initialize === 'function') {
        await bridge.initialize();
      }
      await seedContext();
      cycle = 0;
      tokenUsage = messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0);
    }

    if (!bridge.getModelConfig() && swarmEnabled && !bridge.hasAvailableProvider?.()) {
      const notice = buildSystemNotice(
        'No local host is configured. Remote slot topology is active, so the runtime is parking until a peer host is available.'
      );
      appendMessage('user', notice, 'system');
      tokenUsage += estimateTokens(notice);
      parkRuntime('Waiting for remote host slot', 'provider-ready');
      return;
    }

    running = true;
    stopped = false;
    parked = false;
    wakeOn = 'manual';
    consecutiveSingleToolCycles = 0;
    consecutiveMilestoneOnlyCycles = 0;
    repeatedMilestoneCount = 0;
    lastMilestoneReason = '';
    status = 'RUNNING';
    activity = 'Generating';
    draft = '';
    notify();

    while (!stopped && cycle < MAX_CYCLES) {
      cycle += 1;
      if (await refreshRgrArchiveAnchors()) {
        latestRgrReceiptPath = rgrArchive[0]?.receiptPath || latestRgrReceiptPath;
        notify();
      }
      activity = `Generating cycle ${cycle}`;
      draft = '';
      notify();

      let response;
      try {
        response = await bridge.generate(messages, (chunk) => {
          draft += chunk;
          notify();
        });
      } catch (error) {
        errorCount += 1;
        appendMessage('user', `[SYSTEM ERROR]\n${error.message || error}`, 'system');
        tokenUsage += estimateTokens(error.message || String(error));
        running = false;
        status = 'ERROR';
        activity = 'Generation failed';
        draft = '';
        notify();
        return;
      }

      const assistantText = String(response?.raw || response?.content || '').trim();
      draft = '';
      if (assistantText) {
        candidateCount += 1;
        appendMessage('assistant', assistantText, 'model');
        tokenUsage += estimateTokens(assistantText);
      }

      const directive = parseSelfDirective(responseParser, assistantText);
      if (!directive) {
        errorCount += 1;
        const systemNotice = buildSystemNotice(
          'Ignored non-directive model response. Use REPLOID/0 with TOOL: blocks, PLAN:, MILESTONE:, or IDLE:. Do not use markdown fences.'
        );
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Ignored non-directive response';
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        continue;
      }

      if (directive.type === 'done') {
        const systemNotice = buildMilestoneNotice(directive.reason);
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Milestone recorded';
        consecutiveMilestoneOnlyCycles += 1;
        if (directive.reason && directive.reason === lastMilestoneReason) {
          repeatedMilestoneCount += 1;
        } else {
          lastMilestoneReason = directive.reason || '';
          repeatedMilestoneCount = 1;
        }
        if (
          consecutiveMilestoneOnlyCycles >= MILESTONE_AUTOPARK_THRESHOLD ||
          repeatedMilestoneCount >= MILESTONE_AUTOPARK_THRESHOLD
        ) {
          const parkNotice = buildParkNotice(
            'Repeated milestone-only cycles detected with no new tool work'
          );
          appendMessage('user', parkNotice, 'system');
          tokenUsage += estimateTokens(parkNotice);
          parkRuntime('Repeated milestone-only cycles detected with no new tool work');
          consecutiveMilestoneOnlyCycles = 0;
          repeatedMilestoneCount = 0;
          lastMilestoneReason = '';
          notify();
          return;
        }
        notify();
        continue;
      }

      if (directive.type === 'idle') {
        const parkNotice = buildParkNotice(directive.reason);
        appendMessage('user', parkNotice, 'system');
        tokenUsage += estimateTokens(parkNotice);
        parkRuntime(directive.reason);
        consecutiveMilestoneOnlyCycles = 0;
        repeatedMilestoneCount = 0;
        lastMilestoneReason = '';
        notify();
        return;
      }

      const requestedCalls = Array.isArray(directive.calls) ? directive.calls : [];
      const callsToExecute = requestedCalls.slice(0, MAX_BATCH_TOOLS);
      toolCallCount += callsToExecute.length;
      consecutiveMilestoneOnlyCycles = 0;
      repeatedMilestoneCount = 0;
      lastMilestoneReason = '';

      if (requestedCalls.length > MAX_BATCH_TOOLS) {
        const systemNotice = buildSystemNotice(
          `Tool call limit (${MAX_BATCH_TOOLS}) reached. Executing the first ${MAX_BATCH_TOOLS} tool calls with safe read-only groups batched.`
        );
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
      }

      if (callsToExecute.length === 1) {
        consecutiveSingleToolCycles += 1;
        if (consecutiveSingleToolCycles >= SINGLE_TOOL_NUDGE_THRESHOLD) {
          const systemNotice = buildSystemNotice(
            `Tip: you can batch up to ${MAX_BATCH_TOOLS} tool calls by emitting multiple TOOL_CALL / ARGS blocks in one response.`
          );
          appendMessage('user', systemNotice, 'system');
          tokenUsage += estimateTokens(systemNotice);
          consecutiveSingleToolCycles = 0;
        }
      } else {
        consecutiveSingleToolCycles = 0;
      }

      const executeToolCall = async (call) => {
        if (call.error) {
          return {
            call,
            kind: 'ERROR',
            message: formatToolResult(call.name, call.error, 'ERROR')
          };
        }

        try {
          const result = await bridge.executeTool(call.name, call.args);
          return {
            call,
            kind: 'RESULT',
            message: formatToolResult(call.name, result, 'RESULT')
          };
        } catch (error) {
          return {
            call,
            kind: 'ERROR',
            message: formatToolResult(call.name, error?.message || String(error), 'ERROR')
          };
        }
      };

      const executionGroups = buildToolExecutionGroups(callsToExecute);
      const batchEntries = [];
      for (const [index, group] of executionGroups.entries()) {
        if (stopped) break;

        const firstCall = group.calls[0] || {};
        const groupLabel = group.mode === 'parallel' && group.calls.length > 1
          ? `${group.calls.length} read-only tools`
          : normalizeToolName(firstCall.name) || 'tool';
        activity = executionGroups.length === 1
          ? `Running ${groupLabel}`
          : `Running ${groupLabel} (${index + 1}/${executionGroups.length})`;
        notify();

        const entries = group.mode === 'parallel'
          ? await Promise.all(group.calls.map(executeToolCall))
          : [await executeToolCall(firstCall)];
        const groupErrorCount = entries.filter((entry) => entry.kind === 'ERROR').length;
        errorCount += groupErrorCount;
        batchEntries.push(...entries);
        activity = groupErrorCount > 0
          ? `${groupLabel} failed`
          : `${groupLabel} complete`;
      }

      if (batchEntries.length > 0) {
        await recordRgrArchiveEntry({
          candidateText: assistantText,
          entries: batchEntries,
          groups: executionGroups
        });
        const toolMessage = batchEntries.length === 1
          ? batchEntries[0].message
          : formatToolBatchResult(batchEntries, executionGroups);
        appendMessage('user', toolMessage, 'tool');
        tokenUsage += estimateTokens(toolMessage);
      }

      if (!stopped && directive.milestoneReason !== undefined && directive.milestoneReason !== null) {
        const systemNotice = buildMilestoneNotice(directive.milestoneReason);
        appendMessage('user', systemNotice, 'system');
        tokenUsage += estimateTokens(systemNotice);
        activity = 'Milestone recorded';
      }

      if (!stopped && directive.idleReason !== undefined && directive.idleReason !== null && directive.idleReason !== '') {
        const parkNotice = buildParkNotice(directive.idleReason);
        appendMessage('user', parkNotice, 'system');
        tokenUsage += estimateTokens(parkNotice);
        parkRuntime(directive.idleReason);
        notify();
        return;
      }

      notify();
    }

    running = false;
    status = stopped ? 'IDLE' : 'LIMIT';
    activity = stopped ? 'Stopped by user' : `Stopped at ${MAX_CYCLES} cycles`;
    draft = '';
    notify();
  };

  return {
    subscribe,
    on: bridge.on,
    start,
    stop,
    rotateIdentity: bridge.rotateIdentity,
    isRunning: () => running,
    getSnapshot
  };
}
