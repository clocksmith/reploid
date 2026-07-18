/**
 * @fileoverview Run and inspect governed Doppler runtime-profile searches.
 */

async function call(args = {}, deps = {}) {
  const optimizer = deps.DopplerOptimizer;
  if (!optimizer) {
    throw new Error('DopplerOptimizer is not available on this surface');
  }
  const action = String(args.action || '').trim();
  if (action === 'run') {
    if (!args.contract || typeof args.contract !== 'object' || Array.isArray(args.contract)) {
      throw new Error('DopplerOptimize run requires contract');
    }
    return optimizer.run(args.contract, { runId: args.runId || undefined });
  }
  if (action === 'status') {
    return args.runId ? optimizer.getRun(args.runId) : optimizer.getState();
  }
  if (action === 'list') {
    return optimizer.listRuns();
  }
  if (action === 'cancel') {
    return { cancelled: optimizer.cancel() };
  }
  if (action === 'prepare-promotion') {
    if (!args.runId) throw new Error('DopplerOptimize prepare-promotion requires runId');
    return optimizer.preparePromotion(args.runId, args.candidateId || null);
  }
  throw new Error(`Unsupported DopplerOptimize action: ${action || '(empty)'}`);
}

export const tool = {
  name: 'DopplerOptimize',
  description: 'Run, inspect, or stage a governed Doppler runtime-profile search. Promotion still requires Promote.',
  capabilities: ['vfs:write'],
  inputSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['run', 'status', 'list', 'cancel', 'prepare-promotion']
      },
      runId: { type: 'string' },
      candidateId: { type: 'string' },
      contract: { type: 'object' }
    }
  },
  call
};

export default call;
