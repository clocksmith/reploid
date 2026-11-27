/**
 * The Experiments page (/experiments, the "Spot the imitation" research plugin) without markup. It is the vanilla
 * page's binding (ui/pool-home/research-plugins.js) with the DOM taken out: the same study set-up, consent and
 * recipients review, blind judging, results and export, over the same host port (host/research-plugins.js). The
 * plugin session owns the study record; this owns only what the person has staged on the page.
 */
import { createResearchPlugins } from '../research-plugins.js';

const LATEST = 'reploid.plugin-latest:model-imitation';

export function createExperimentsController(host, { storage = globalThis.localStorage, locks = globalThis.navigator?.locks,
  createService = createResearchPlugins } = {}) {
  const service = createService({ ...host, storage });
  const listeners = new Set();
  let session = null, unsubscribeSession = () => {}, detached = false, release = null, owned = false;
  let error = '', latest = null, opening = false, snapshot = null;
  let targetId = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', imitatorId = 'qwen-3-8-27b-text-q4k-ef16-af32';
  let judgment = { choice: null, confidence: 50 };
  let reviewed = null;

  const notify = () => { if (detached) return; snapshot = project(); for (const listener of listeners) listener(); };
  const run = async action => { error = ''; try { await action(); } catch (cause) { error = cause.message; } notify(); };
  const attach = opened => {
    unsubscribeSession(); session?.close(); session = opened; latest = opened;
    judgment = { choice: null, confidence: 50 };
    unsubscribeSession = session.subscribe(() => notify());
  };

  function project() {
    const base = { error, footer: session ? { visible: !session.view().busy } : null };
    if (!session) {
      const offers = service.models().map(model => ({ id: model.id, name: model.name, identity: model.identity, recipients: service.recipients(model) }));
      reviewed = { target: offers.find(model => model.id === targetId), imitator: offers.find(model => model.id === imitatorId) };
      const ready = !!(reviewed.target?.recipients.length && reviewed.imitator?.recipients.length) && targetId !== imitatorId;
      const option = model => ({ value: model.id, title: model.name + (model.recipients.length ? '' : ' · waiting for capacity') });
      let waiting = '';
      if (!ready) {
        waiting = targetId === imitatorId
          ? 'Choose two different models.'
          : 'Waiting for available capacity for both selected models.';
      }
      return Object.freeze({ ...base, phase: 'setup',
        models: offers.map(option), targetId, imitatorId,
        recipients: Object.values(reviewed).filter(Boolean).flatMap(model => model.recipients.map(id => `${model.name}: ${id}`)),
        waiting,
        canStart: owned && ready && !opening, canRestore: latest ? owned && !opening : null });
    }
    const view = session.view(), content = view.content;
    if (content.phase === 'complete') {
      const trials = content.results.filter(row => row.condition !== 'same-model');
      const controls = content.results.filter(row => row.condition === 'same-model');
      return Object.freeze({ ...base, phase: 'complete',
        identified: `${trials.filter(row => row.correct).length}/${trials.length} imitation rounds identified.`,
        controls: `${controls.filter(row => !['same', 'unsure'].includes(row.judgment.choice)).length}/${controls.length} controls incorrectly called an imitation.`,
        rows: content.results.map(row => [row.task, row.condition, row.judgment.choice, row.actual]) });
    }
    if (view.status !== 'ready' && !view.busy) return Object.freeze({ ...base, phase: 'stopped', status: view.status });
    if (content.phase === 'judging' && !view.busy) {
      return Object.freeze({ ...base, phase: 'judging', round: content.round, total: content.total, prompt: content.prompt,
        followup: content.followup || '', canFollowup: !!content.canFollowup,
        answers: content.answers.map((answers, side) => ({ side: side ? 'B' : 'A',
          turns: answers.map((text, turn) => ({ label: turn ? 'Follow-up' : 'First answer', text })) })),
        choice: judgment.choice, confidence: judgment.confidence });
    }
    return Object.freeze({ ...base, phase: 'preparing' });
  }

  // Reuse the browser's ownership primitive: another tab cannot write or generate for this activity.
  if (locks?.request) {
    void locks.request('reploid:research-plugins', { ifAvailable: true }, async lock => {
      if (!lock || detached) { error = 'Research is already open in another tab.'; notify(); return; }
      owned = true;
      latest = storage.getItem(LATEST); notify();
      await new Promise(resolve => { release = resolve; });
    }).catch(cause => { error = cause.message; notify(); });
  } else error = 'This browser cannot acquire exclusive study storage.';
  // Capacity arriving changes the set-up's recipients and readiness.
  const stopUpdates = host.chat?.subscribe?.(() => { if (!session) notify(); }) ?? (() => {});
  snapshot = project();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setTarget(id) { targetId = id; notify(); },
    setImitator(id) { imitatorId = id; notify(); },
    start() {
      if (opening || !owned) return;
      opening = true; notify();
      const selection = reviewed;
      void run(async () => {
        try {
          const opened = await service.create({ targetId, imitatorId, approved: true, reviewed: selection });
          if (detached) { await opened.close(); return; }
          attach(opened); await session.dispatch({ type: 'start' });
        } finally { opening = false; }
      });
    },
    restore() {
      if (opening || !owned) return;
      opening = true; notify();
      void run(async () => {
        try {
          const opened = await service.restore();
          if (detached) { await opened?.close(); return; }
          if (opened) attach(opened);
        } finally { opening = false; }
      });
    },
    stop() { session?.cancel(); },
    followup() { void run(() => session.dispatch({ type: 'followup' })); },
    setJudgment(choice) { judgment = { ...judgment, choice }; notify(); },
    setConfidence(confidence) { judgment = { ...judgment, confidence }; notify(); },
    judge() {
      if (!judgment.choice) { error = 'Choose A, B, both target, or unsure.'; notify(); return; }
      const { choice, confidence } = judgment;
      void run(async () => { await session.dispatch({ type: 'judge', choice, confidence }); judgment = { choice: null, confidence: 50 }; });
    },
    newStudy() { unsubscribeSession(); session?.close(); session = null; error = ''; notify(); },
    /** Exporting before the study completes reveals assignments; the page confirms that first. */
    exportNeedsConfirmation() { return session?.view().content.phase !== 'complete'; },
    exportRecord() {
      const view = session.view();
      return { name: `reploid-study-${view.sessionId}.json`, text: JSON.stringify(session.export(), null, 2), type: 'application/json' };
    },
    dispose() {
      if (detached) return;
      detached = true; unsubscribeSession(); stopUpdates(); listeners.clear();
      void Promise.resolve(session?.close()).finally(() => release?.());
    }
  };
}
