# Diagnostic planning

Reploid's optional `reploid/diagnostics` entry implements finite Bayesian
diagnostics and explicit action selection. It runs through the shared agent
execution engine. It is available to hosts composing Zero or Work; it does not
change their default planning strategy or grant permissions.

## Responsibility and evidence

The library owns belief updates, action scores and execution lifecycle. The host
owns the diagnostic model, tools, normalized costs, observation admission and
authorization. Doppler can supply learned predictions through a host adapter;
Poolday can supply an authorized peer measurement through an existing job tool.
Neither is required by the planner. A peer receipt is not a calibrated likelihood
or proof of an independent experiment.

The Discovery Contract already describes competing hypotheses, falsifiers,
predicted observations and action value. This library entry supplies reusable
numerical machinery. It does not replace Research Room's signed candidate-action
ranker, admission rules or scientific uncertainty representations.

## Model and objective

The versioned JSON model declares a finite, static hidden-state space, a prior,
an observation distribution for each action and hypothesis, terminal decisions
and their utilities. Actions declare costs in the same utility units, tool calls,
and evidence groups. Include an alternative hypothesis when the known causes
are not exhaustive. Every likelihood table needs explicit provenance. The API
accepts `synthetic` or `host-supplied`; neither means calibrated.

For observation `o` from action `a`, the posterior is:

```text
posterior[h] = prior[h] * likelihood[a][h][o] / predictiveProbability[o]
```

Unknown and zero-probability observations reject without changing beliefs.
Preferences never enter this update. Changing a utility cannot make a repair
more likely to have succeeded.

Define `V(b)` as the greatest expected terminal-decision utility at belief `b`.
Each eligible action reports:

```text
decisionValue   = sum_o P(o | a, b) V(posterior(b, a, o)) - V(b)
informationGain = H(b) - sum_o P(o | a, b) H(posterior(b, a, o))
```

Information is measured in nats. The required JSON policy selects:

| Objective | Action score |
| --- | --- |
| `task-value` | `-cost`: myopic baseline with no value assigned to future observation |
| `decision-value` | `decisionValue - cost`: exact one-experiment value of information |
| `utility-information` | `decisionValue + informationWeight * informationGain - cost` |

The last objective makes information an additional preference. It is an
active-inference-inspired comparison, not a general expected-free-energy or
Bayes-optimal POMDP implementation. Terminal utility already values the next
decision's use of evidence; the information bonus is not counted as additional
task utility. Deep learning can parameterize the model without changing these
distinctions. See [Millidge](https://arxiv.org/abs/1907.03876) and the
[POMDP comparison](https://arxiv.org/html/2408.06542v1).

Scores are recomputed after each observation, but only one experiment is valued
at a time. Complementary tests that are useful only together can be missed.
Actions do not change the hidden state in this model; it must not be used to
represent a repair that changes the fault. Terminal decisions are recommendations,
not automatically executed repairs or accepted scientific conclusions.

## Host composition

```js
import { createDiagnosticInvestigation } from 'reploid/diagnostics';
import { resolveConfig } from 'reploid/config';

const investigation = createDiagnosticInvestigation({
  model: diagnosticModel, // Host-supplied versioned JSON, including likelihoods.
  policy: {
    schema: 'reploid.diagnostic-policy/v1',
    objective: 'decision-value',
    costBudget: 0.16,
    maxActions: 2,
    informationWeight: 0,
    minimumScore: 0
  },
  config: resolveConfig({ overrides: { tools: { allowed: ['MeasureDiagnostic'] } } }),
  ports: {
    instanceId: 'investigation-1',
    authorize: hostAuthorization,
    async executeTool(name, args, { signal }) {
      // Admit and classify actual results here; do not return a model's guess.
      const measured = await hostTools[name](args, { signal });
      return { outcomeId: measured.outcomeId, evidenceId: measured.evidenceId };
    }
  }
});
try {
  const result = await investigation.run();
  const auditRecord = investigation.checkpoint();
  // The host presents the recommendation and retains the record.
} finally {
  await investigation.close();
}
```

The declarations define the complete model and result shapes. A runnable
synthetic model is in [the test fixture](../tests/fixtures/diagnostic-model.js).
Hosts may use the pure `createBeliefPlanner()` API inside their own planning
strategy without introducing an execution loop.

## Lifecycle and limits

- Construction and imports are inert. Configuration and host authorization gate
  every tool call through the existing engine.
- Policies are detached and frozen on construction. No route or storage setting
  changes an active attempt. Unknown fields and invalid distributions reject.
- The tighter of the diagnostic action limit and engine cycle limit applies.
  An action must fit the remaining cost budget and exceed `minimumScore`.
- Costs are reserved before dispatch. Failed, denied and cancelled attempts
  retain their declared cost conservatively. These are budget units, not measured
  billing, GPU seconds or wall time. Hosts enforce actual resource bounds.
- Each action is attempted once. Actions sharing an evidence group cannot both
  run. Other observations are assumed conditionally independent given the hidden
  state; a different machine or evidence ID alone does not establish this.
- Repeated evidence IDs reject. Invalid results and tool failures preserve the
  previous belief and retain their failure history.
- Cancellation suppresses late updates. `close()` waits for borrowed tool work
  to settle; it cannot forcibly terminate JavaScript or GPU work.
- A cancelled or blocked instance can be run again using its remaining budget.
  Checkpoints are detached audit records, not portable resume tokens. No store
  or persistence transaction is owned by this entry.

## Controlled comparison

Run:

```sh
npx vitest run tests/unit/belief-planner.test.js tests/integration/diagnostic-strategy.test.js
node tests/diagnostic-planning-comparison.js
npx playwright test tests/e2e/diagnostic-strategy.spec.js --project=chromium
```

The comparison exhausts 16 synthetic states: four GPU-fault labels crossed with
four irrelevant labels. The evaluator supplies observations independently of the
planner's likelihood lookup. Every policy receives the same model, available
probes, two-action limit and 0.16 cost budget. There is no neural inference in
this fixture. The existing Poolday ranker is called directly with a declared,
retained ordinal mapping; it grants no execution authority.

| Policy | Correct recommendations | Mean declared cost | Multiclass Brier score |
| --- | --- | --- | --- |
| Myopic task value | 25% | 0 | 0.75 |
| Existing heuristic with declared mapping | 50% | 0.06 | 0.5 |
| One-experiment decision value | 100% | 0.11 | 0 |
| Utility plus information, weight 1 | 50% | 0.06 | 0.5 |

The fixture deliberately includes information that cannot improve the repair
decision. These results demonstrate that distinction and verify this software
contract. They do not establish general superiority, empirical calibration,
physical GPU diagnosis, peer independence or recursive improvement.

The [retained report](../artifacts/diagnostic-planning/comparison.json) includes
the model, budgets, mapping, source hashes and every episode. Real diagnostic
adoption requires measured outcomes, frozen evaluation cases and independent
authorization under the existing improvement contracts.

*Last updated: September 2026*
