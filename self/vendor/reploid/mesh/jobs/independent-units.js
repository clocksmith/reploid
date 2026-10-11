import { snapshotJson } from '../../config/index.js';

const assert = (ok, message) => { if (!ok) throw new Error(`Independent units: ${message}`); };
const equal = (a, b) => JSON.stringify(snapshotJson(a)) === JSON.stringify(snapshotJson(b));
const clone = value => snapshotJson(value);

/** Subdivide one approved embedding application; all execution uses existing signed jobs. */
export function createIndependentUnitCoordinator({ requesterId, journal, operation, validateApplication,
  authorize, hashEvidence, prepareJob, runPrepared, limits }) {
  for (const [name, port] of Object.entries({ validateApplication, authorize, hashEvidence, prepareJob, runPrepared })) {
    assert(typeof port === 'function', `${name} port required`);
  }
  assert(operation?.definition?.dopplerOperation?.name === 'embed'
    && operation.definition.dopplerOperation.version === 1, 'embed.v1 operation required');
  limits = clone(limits);
  for (const field of ['maxUnits', 'maxInputBytes', 'maxConcurrentUnits']) {
    assert(Number.isSafeInteger(limits[field]) && limits[field] > 0, `bounded ${field} required`);
  }
  const active = new Set();
  let closed = false;
  const permitted = async (action, manifest, unit = null) => {
    assert(!closed, 'coordinator closed');
    assert(await authorize({ action, manifest: clone(manifest), unit: unit ? clone(unit) : null }) === true, 'authorization denied');
    assert(!closed, 'coordinator closed');
  };
  const checked = async row => {
    assert(row.requesterId === requesterId, 'requester identity mismatch');
    const { identity, ...content } = row.manifest;
    assert(await hashEvidence(content) === identity, 'retained manifest identity mismatch');
    await validateApplication(clone(row.manifest.application), clone(row.manifest.binding));
    for (const unit of row.units) if (unit.outcome) {
      const specification = row.manifest.units.find(value => value.unitId === unit.unitId);
      const { job, execution } = unit.outcome.result;
      assert(unit.attempts.at(-1)?.jobHash === job.messageHash && specification
        && await hashEvidence({ jobHash: job.messageHash, execution }) === unit.outcome.identity,
      'retained outcome identity mismatch');
      operation.validateOutput(execution.output, execution.request, { completed: true });
      assert(operation.compare(execution.output, specification.reference, specification.comparisonPolicy), 'retained output failed frozen comparison');
    }
    return row;
  };
  const collect = row => {
    const embeddings = new Array(row.manifest.binding.input.texts.length);
    for (const unit of row.units) if (unit.outcome) {
      const specification = row.manifest.units.find(value => value.unitId === unit.unitId);
      specification.positions.forEach((position, index) => { embeddings[position] = unit.outcome.result.execution.output.embeddings[index]; });
    }
    return { parentId: row.parentId, status: row.status,
      pendingUnitIds: row.units.filter(unit => !unit.outcome).map(unit => unit.unitId),
      committedUnitIds: row.units.filter(unit => unit.outcome).map(unit => unit.unitId),
      output: row.status === 'completed' ? { embeddings } : null };
  };
  return {
    async create({ parentId, application, model, input, options, comparisonPolicy, reference, unitSize, expiresAt }) {
      assert(Number.isSafeInteger(unitSize) && unitSize > 0, 'positive unit size required');
      const binding = clone({ model, input, options, comparisonPolicy, reference });
      application = clone(application);
      assert(new TextEncoder().encode(JSON.stringify({ application, binding })).length <= limits.maxInputBytes,
        'input budget exhausted');
      operation.validateRequest(binding);
      assert(Math.ceil(binding.input.texts.length / unitSize) <= limits.maxUnits, 'unit budget exhausted');
      operation.validateOutput(binding.reference, binding, { completed: true });
      assert(binding.comparisonPolicy?.operation?.name === 'embed' && binding.comparisonPolicy.operation.version === 1
        && binding.comparisonPolicy.rule === 'numerical-tolerance'
        && binding.comparisonPolicy.referenceDigest === await hashEvidence(binding.reference), 'frozen numerical reference required');
      await validateApplication(clone(application), clone(binding));
      const units = [];
      for (let offset = 0; offset < binding.input.texts.length; offset += unitSize) {
        const positions = Array.from({ length: Math.min(unitSize, binding.input.texts.length - offset) }, (_, index) => offset + index);
        const unitInput = { ...binding.input, texts: positions.map(position => binding.input.texts[position]) };
        const unitReference = { ...binding.reference, embeddings: positions.map(position => binding.reference.embeddings[position]) };
        const unitPolicy = { ...binding.comparisonPolicy, referenceDigest: await hashEvidence(unitReference) };
        const unitId = await hashEvidence({ requesterId, parentId, application, model: binding.model,
          input: unitInput, options: binding.options, comparisonPolicy: unitPolicy, positions });
        units.push({ unitId, positions, input: unitInput, reference: unitReference, comparisonPolicy: unitPolicy });
      }
      const content = clone({ requesterId, parentId, application, binding, expiresAt, units });
      const manifest = { ...content, identity: await hashEvidence(content) };
      await permitted('create', manifest);
      return collect(await journal.create(manifest));
    },
    async get(parentId) {
      const row = await checked(await journal.get(parentId));
      await permitted('read', row.manifest);
      return collect(row);
    },
    async runUnit(parentId, unitId, { replace = false, signal = null } = {}) {
      assert(!closed && active.size < limits.maxConcurrentUnits, 'active unit budget exhausted or coordinator closed');
      const controller = new AbortController();
      const record = { parentId, controller };
      const abort = () => controller.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      active.add(record);
      try {
        controller.signal.throwIfAborted();
        let row = await checked(await journal.get(parentId));
        const specification = row.manifest.units.find(unit => unit.unitId === unitId);
        let unit = row.units.find(value => value.unitId === unitId);
        assert(specification && unit, 'unknown unit');
        await permitted('execute', row.manifest, specification);
        if (unit.outcome) return collect(row);
        assert(row.status === 'pending' && row.expiresAt > Date.now(), 'aggregate inactive');
        let attempt = unit.attempts.at(-1);
        if (!attempt || replace) {
          const number = (attempt?.attemptNumber ?? 0) + 1;
          const job = clone(await prepareJob({ model: clone(row.manifest.binding.model), input: clone(specification.input),
            options: clone(row.manifest.binding.options), comparisonPolicy: clone(specification.comparisonPolicy),
            jobId: unitId, attemptNumber: number, expiresAt: row.expiresAt, signal: controller.signal }));
          controller.signal.throwIfAborted();
          const intent = job.body?.intent;
          assert(job.fromPeerId === requesterId && intent?.jobId === unitId && intent.attemptNumber === number
            && job.body.request.operation.name === 'embed' && job.body.request.operation.version === 1
            && equal(intent.model, row.manifest.binding.model) && equal(job.body.request.input, specification.input)
            && equal(job.body.request.options, row.manifest.binding.options)
            && equal(intent.comparisonPolicy, specification.comparisonPolicy), 'prepared signed job changed unit binding');
          attempt = { jobHash: job.messageHash, job, providerId: job.toPeerId,
            assignmentId: job.body.assignment.assignmentId, attemptId: intent.attemptId, attemptNumber: number };
          row = await journal.assign(parentId, unitId, number - 1, attempt);
        }
        await permitted('execute', row.manifest, specification);
        controller.signal.throwIfAborted();
        const result = clone(await runPrepared({ job: clone(attempt.job), reference: clone(specification.reference), signal: controller.signal }));
        controller.signal.throwIfAborted();
        assert(result.job?.messageHash === attempt.jobHash && equal(result.job, attempt.job)
          && equal(result.execution?.request, attempt.job.body.request) && result.assessment?.accepted === true,
        'accepted signed job result required');
        operation.validateOutput(result.execution.output, result.execution.request, { completed: true });
        assert(operation.compare(result.execution.output, specification.reference, specification.comparisonPolicy), 'output failed frozen comparison');
        await permitted('commit', row.manifest, specification);
        controller.signal.throwIfAborted();
        const outcome = { identity: await hashEvidence({ jobHash: attempt.jobHash, execution: result.execution }), result };
        return collect(await journal.commit(parentId, unitId, attempt.jobHash, outcome));
      } finally {
        active.delete(record);
        signal?.removeEventListener('abort', abort);
      }
    },
    async cancel(parentId) {
      const row = await checked(await journal.get(parentId));
      await permitted('cancel', row.manifest);
      const cancelled = await journal.cancel(parentId);
      for (const record of active) if (record.parentId === parentId) record.controller.abort(new Error('Independent request cancelled'));
      return collect(cancelled);
    },
    close() {
      closed = true;
      for (const record of active) record.controller.abort(new Error('Independent coordinator closed'));
      // Journal and requester ports are borrowed. Their owners close them after settlement.
    }
  };
}
