export function deriveOutcomeTags(row) {
  if (!row) return [];
  const tags = [];
  const artifacts = row.artifacts || [];

  const hasJsonSuccess = artifacts.some(item =>
    item.inspection?.checks?.some(check => check.name === 'json-syntax' && check.passed === true));
  const hasSyntaxFailure = artifacts.some(item =>
    item.inspection?.checks?.some(check => check.passed === false));

  if (hasJsonSuccess) {
    tags.push('JSON validated');
  } else if (hasSyntaxFailure) {
    tags.push('Syntax error');
  }

  const patchExts = ['.patch', '.diff', '.json', '.js', '.ts', '.py', '.sh', '.html', '.css', '.wgsl'];
  const hasCodeArtifact = artifacts.some(item => {
    const lower = (item.name || '').toLowerCase();
    return patchExts.some(ext => lower.endsWith(ext));
  });
  const hasDraftedPatch = hasCodeArtifact || (row.output && /```(diff|patch|js|ts|json|python|bash)/i.test(row.output));

  if (hasDraftedPatch) {
    tags.push('Patch drafted');
    tags.push('Needs execution');
  } else if (artifacts.length > 0) {
    tags.push('Deliverable ready');
    tags.push('Needs execution');
  } else if (row.status === 'review' && row.output && /patch|code|diff|function|script/i.test(row.output)) {
    tags.push('Patch drafted');
    tags.push('Needs execution');
  }

  return tags;
}

export function readonlyView(value) {
  const freeze = item => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(JSON.parse(JSON.stringify(value)));
}

export const projectWorkRecord = row => readonlyView({
    revision: row.revision, persistence: row.persistence, execution: row.execution,
    id: row.id, parentId: row.parentId, goal: row.goal, modelId: row.modelId,
    modelName: row.modelName, createdAt: row.createdAt, status: row.status,
    output: row.output, review: row.review, error: row.error,
    checkpointAvailable: !!row.checkpoint, criteria: row.criteria, feedback: row.feedback,
    inputs: row.inputs, artifacts: row.artifacts, events: row.events,
    peerJobs: row.peerJobs, allowPeers: row.allowPeers, recallAccepted: row.recallAccepted,
    outcomeTags: row.outcomeTags || deriveOutcomeTags(row)
  });
