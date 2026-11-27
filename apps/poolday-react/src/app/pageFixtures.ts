// In-memory hosts for the Changes and Experiments specimens on /design and their unit tests: a work session with
// one reviewed attempt and one failed revision of it, an evolution owner with one tested candidate, and a catalog
// with two connected study models. Nothing here runs a task, a tool or a model.
const listeners = () => {
  const set = new Set<(value: unknown) => void>();
  return { add: (fn: (value: unknown) => void) => (set.add(fn), () => void set.delete(fn)), emit: (value: unknown) => set.forEach((fn) => fn(value)) };
};

const createdAt = Date.UTC(2026, 10, 20, 15, 0);

export function createImproveHost({ empty = false }: { readonly empty?: boolean } = {}) {
  const changes = listeners();
  const records = empty
    ? []
    : [
        { id: 'attempt-1', goal: 'Summarize the release notes', modelName: 'Qwen 3.5 2B', modelId: 'qwen-2b', status: 'review', createdAt,
          output: 'Three fixes and one new route. Nothing needs action.', criteria: 'Under 40 words, names every change.',
          events: [{ tool: 'read_file', status: 'ok' }], artifacts: [], review: { accepted: true }, improvements: [{ id: 'candidate-1' }] },
        { id: 'attempt-2', parentId: 'attempt-1', feedback: 'Name the new route.', goal: 'Summarize the release notes, naming the new route',
          modelName: 'Qwen 3.5 2B', modelId: 'qwen-2b', status: 'failed', createdAt: createdAt + 60_000, output: '',
          error: 'The contributor disconnected.', events: [{ tool: 'read_file', status: 'failed', error: 'Connection closed' }], artifacts: [] },
      ];
  const state = { records, selectedId: null as string | null, runningIds: [] as string[], busy: false, anyBusy: false, available: true, activity: 'Idle', draft: '' };
  const work = {
    getState: () => state,
    subscribe(fn: (value: unknown) => void) { const stop = changes.add(fn); fn(state); return stop; },
    select(id: string) { state.selectedId = id; changes.emit(state); },
    review(id: string, accepted: boolean) { const row = records.find((item) => item.id === id) as { review?: object } | undefined; if (row) row.review = { accepted }; changes.emit(state); },
    prepareRevision: () => undefined,
    getArtifact: () => ({ name: 'notes.txt', text: '' }),
    exportRecords: () => records,
  };
  const candidates = empty
    ? []
    : [{ id: 'candidate-1', targetId: 'read_file', status: 'awaiting-approval', reason: 'Reads large files in one pass.', code: 'export default async function readFile(path) {\n  return vfs.read(path);\n}',
        evaluation: { baselinePassed: 4, candidatePassed: 5, total: 5, improvementKind: 'correctness' } }];
  const evolution = {
    list: async () => candidates,
    describe: async () => [],
    decide: async () => undefined,
    rollback: async () => undefined,
    export: async () => ({}),
  };
  return { work, evolution };
}

export function createExperimentsHost() {
  const model = (id: string, name: string, digit: string) => ({ id, name, identity: `sha256:${digit.repeat(64)}`, provider: 'doppler' });
  const models = [model('qwen-3-5-0-8b-q4k-ef16-af32-vf16', 'Qwen 3.5 0.8B', 'a'), model('qwen-3-8-27b-text-q4k-ef16-af32', 'Qwen 3.8 27B', 'b')];
  const peers = models.map((entry, index) => ({ id: `peer-${index}`, model: entry.id, modelIdentity: entry.identity, role: 'provider', readiness: 'ready', availableSlots: 1,
    identityVerified: true, admissionProtocol: 2, participantId: `participant-${index + 1}` }));
  return {
    chat: { getState: () => ({ models }), subscribe: () => () => undefined },
    swarm: { getState: () => ({ consumer: { peers } }) },
  };
}
