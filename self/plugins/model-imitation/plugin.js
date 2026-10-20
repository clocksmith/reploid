import manifest from './manifest.json' with { type: 'json' };

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const effect = (state, tag, model, messages) => ({ capability: 'model.generate', input: { tag, model,
  messages, maxOutputTokens: state.config.protocol.maxOutputTokens } });
const user = content => ({ role: 'user', content });
const armRequest = (state, armIndex, followup = false) => {
  const round = state.rounds[state.round], arm = round.arms[armIndex], task = state.config.protocol.cases[round.caseIndex];
  const imitate = arm.role === 'imitation';
  const messages = [];
  if (imitate) {
    let instruction = state.config.protocol.imitation.replace('TARGET', state.config.target.name);
    if (round.condition === 'examples') instruction += '\nExamples from the target (separate from this task):\n'
      + state.examples.map(row => JSON.stringify({ prompt: row.prompt, answer: row.answer })).join('\n');
    messages.push({ role: 'system', content: instruction });
  }
  messages.push(user(task.prompt));
  if (followup) messages.push({ role: 'assistant', content: arm.answers[0].content }, user(task.followup));
  return effect(state, { kind: 'answer', round: state.round, arm: armIndex, turn: followup ? 1 : 0 },
    imitate ? state.config.imitator : state.config.target, messages);
};

export const modelImitationPlugin = {
  manifest,
  initialize(config) {
    assert(config?.target?.identity && config?.imitator?.identity && config.target.identity !== config.imitator.identity, 'Choose two different exact models');
    const protocol = config.protocol;
    assert(protocol?.version === '1.0.0' && protocol.cases.length === 4 && protocol.calibration.length === 2, 'Unsupported study protocol');
    assert(Array.isArray(config.order) && new Set(config.order).size === 4 && config.order.every(n => Number.isInteger(n) && n >= 0 && n < 4), 'Invalid frozen trial order');
    assert(Array.isArray(config.conditionOrder) && new Set(config.conditionOrder).size === 4
      && config.conditionOrder.every(n => Number.isInteger(n) && n >= 0 && n < 4), 'Invalid frozen condition order');
    assert(config.sides?.length === 4 && config.sides.every(n => n === 0 || n === 1), 'Invalid frozen side assignment');
    return { config, phase: 'new', round: 0, examples: [], rounds: config.order.map((caseIndex, index) => {
      const condition = protocol.conditions[config.conditionOrder[index]], side = config.sides[index];
      return { caseIndex, condition, judgment: null, revealFollowup: false, arms: [0, 1].map(i => ({
        role: condition === 'same-model' || i !== side ? 'target' : 'imitation', answers: [] })) };
    }) };
  },
  transition(state, event) {
    let effects = [];
    if (event.type === 'start') {
      assert(state.phase === 'new', 'Study already started'); state.phase = 'calibrating';
      effects = state.config.protocol.calibration.map((prompt, index) => effect(state, { kind: 'calibration', index }, state.config.target, [user(prompt)]));
    } else if (event.type === 'effect.completed') {
      const { tag } = event.input, answer = event.output;
      assert(typeof answer.content === 'string' && answer.content.length <= state.config.protocol.maxAnswerCharacters, 'Invalid answer');
      if (tag.kind === 'calibration') {
        state.examples.push({ prompt: state.config.protocol.calibration[tag.index], answer: answer.content });
        if (state.examples.length === 2) { state.phase = 'answering'; effects = [armRequest(state, 0), armRequest(state, 1)]; }
      } else {
        assert(tag.round === state.round, 'Stale trial response');
        const round = state.rounds[state.round];
        assert(round.arms[tag.arm].answers.length === tag.turn, 'Duplicate or out-of-order answer');
        round.arms[tag.arm].answers.push(answer);
        if (round.arms.every(arm => arm.answers.length === tag.turn + 1)) {
          if (tag.turn === 0) effects = [armRequest(state, 0, true), armRequest(state, 1, true)];
          else if (state.round + 1 < state.rounds.length) {
            state.round++; effects = [armRequest(state, 0), armRequest(state, 1)];
          } else { state.round = 0; state.phase = 'judging'; }
        }
      }
    } else if (event.type === 'followup') {
      assert(state.phase === 'judging' && !state.rounds[state.round].revealFollowup, 'Follow-up unavailable');
      state.rounds[state.round].revealFollowup = true;
    } else if (event.type === 'judge') {
      assert(state.phase === 'judging' && ['A', 'B', 'same', 'unsure'].includes(event.choice), 'Choose a judgment');
      assert(Number.isInteger(event.confidence) && event.confidence >= 0 && event.confidence <= 100, 'Confidence must be 0–100');
      const round = state.rounds[state.round];
      round.judgment = { choice: event.choice, confidence: event.confidence };
      state.round++;
      if (state.round === state.rounds.length) state.phase = 'complete';
    } else throw new Error('Unknown study action');
    return { state, effects };
  },
  project(state) {
    const round = state.rounds[state.round];
    if (state.phase === 'complete') return { phase: 'complete', results: state.rounds.map(row => {
      const task = state.config.protocol.cases[row.caseIndex];
      const actual = row.condition === 'same-model' ? 'same' : row.arms[0].role === 'imitation' ? 'A' : 'B';
      return { task: task.id, condition: row.condition, judgment: row.judgment, actual,
        correct: row.judgment.choice === actual, answers: row.arms.map(arm => ({ role: arm.role,
          correctByTurn: arm.answers.map(answer => answer.content.trim() === task.expected) })) };
    }) };
    // No assignment, model identity, latency, generation order or partial answers cross this projection.
    return { phase: state.phase, round: state.round + 1, total: state.rounds.length,
      prompt: state.phase === 'judging' ? state.config.protocol.cases[round.caseIndex].prompt : null,
      followup: state.phase === 'judging' && round.revealFollowup ? state.config.protocol.cases[round.caseIndex].followup : null,
      canFollowup: state.phase === 'judging' && !round.revealFollowup,
      answers: state.phase === 'judging' ? round.arms.map(arm => arm.answers.slice(0, round.revealFollowup ? 2 : 1).map(answer => answer.content)) : [] };
  }
};
