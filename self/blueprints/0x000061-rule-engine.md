# Blueprint 0x000061: Rule Engine

**Classification:** Canonical Full Specification

**Implementation Status:** Implemented

**Verified Artifacts:** `/self/capabilities/cognition/symbolic/rule-engine.js`, `/tests/unit/rule-engine.test.js`

**Planned Artifacts:** None

**Owned Source Files:** `capabilities/cognition/symbolic/rule-engine.js`

**Former Blueprint Paths:** `self/blueprints/0x000061-rule-engine.md`
**Module:** `RuleEngine` (version 3.0.0, type `service`)
**File:** `self/capabilities/cognition/symbolic/rule-engine.js`, with helpers `symbolic/rule-unification.js` (matching, unification, pattern finding) and `symbolic/rule-context.js` (path lookup, templates, condition operators)
**Genesis level:** `cognition` (`self/config/genesis-levels.json`)
**Dependencies:** `Utils`, `VFS`, `EventBus`, `KnowledgeGraph`; optional `HITLController`, `VerificationManager`, `ToolRunner`, `StateManager`
**Purpose:** Datalog-style forward chaining over knowledge-graph triples, constraint checks, rule induction from examples, action policies, and declarative agent rules.

## Contract

The module holds six collections: rules, constraints, induced rules, policies, examples and agent rules (`:42-49`). They have different shapes; there is no single `addRule(name, condition, action)` with JavaScript callbacks.

| Collection | Shape | Used by |
| --- | --- | --- |
| Rule | `{ id, head: { predicate, args }, body: [atoms], priority = 50, confidence = 1.0, source, enabled }`; variables are strings starting with `?` | `infer`, `queryWithInference` |
| Constraint | `{ id, body: [atoms], message, severity = 'error' }`; a match is a violation | `validate` |
| Policy | `{ id, name, trigger: atom, action: 'log' \| 'deny' \| 'require_approval', level: 'L1'–'L3' }` | `checkPolicy`, `enforcePolicy` |
| Agent rule | `{ id, name, conditions: [{ path, op, value }], actions: [{ type, params }], priority, once, tags }` | `evaluateAgentRules` |

Built-ins added at `init` (`:251-305`, `:1434-1494`): rules `builtin-isa-transitive` and `builtin-avoid-failing-tool`; policy `builtin-substrate-approval` (writes under `/core/` or to a path containing `agent-loop` require L3 approval); agent rules `builtin-high-cycle-warning` (cycle ≥ 40, fires once) and `builtin-tool-error-tracking`. Built-in rules cannot be removed.

### Inference

`infer(maxIterations = 10)` (`:450-523`) loads every triple as a fact `{ predicate, args: [subject, object] }`, applies enabled rules by descending priority, and repeats until no new facts appear. Derived facts get confidence `rule.confidence × 0.9`. Two-argument derived facts are written back to the knowledge graph with source `inferred` and provenance `Rule: <id>`; facts with other arities stay in the returned list only.

### Induction and approval

`addExample` and every new triple (`cognition:symbolic:add`, handled at `:114-119`) call `checkForInductionOpportunity` (`:688-728`). Three or more positive examples with the same output predicate and a common body pattern induce a rule with priority 30. `induceRule` (`:612-661`) requests `approve_induced_rules` from HITLController only when security is enabled and HITLController says approval is required; otherwise the rule is active immediately.

`enforcePolicy` (`:964-1025`) resolves `require_approval` through HITLController (2-minute timeout), then VerificationManager, and otherwise denies. With security disabled it returns `allowed: true, securityDisabled: true` without asking anyone.

The `approve_rule_changes` capability is registered with HITLController (`:96-100`) but no code path requests it: `addRule`, `addConstraint`, `addPolicy` and `addAgentRule` apply immediately.

### Agent rules and actions

`evaluateAgentRules(context, { tags, dryRun, maxRules, stopOnFirst })` (`:1290-1385`) matches every condition with `matchCondition` (operators `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `contains`, `startsWith`, `endsWith`, `exists` and others in `rule-context.js:130-247`) and runs actions. Default action handlers (`:1033-1126`): `log`, `setState`, `emit`, `executeTool`, `addFact`, `sequence`, `conditional`; `registerActionHandler` adds more. `executeTool` calls `ToolRunner.execute` directly, so an agent rule can run a tool without a separate approval step.

## Current callers

Only `CognitionAPI` calls this module (`init`, `infer`, `validate`, `addRule`, `addConstraint`, `getStats`; see [0x000063](0x000063-cognition-api.md)). Nothing in `self/` outside this file calls `checkPolicy`, `enforcePolicy` or `evaluateAgentRules`. `infrastructure/policy-engine.js` lists `RuleEngine` as an optional dependency but does not call it. Policies and agent rules are therefore available but not wired into tool execution.

## Storage

| Path | Content | Source |
| --- | --- | --- |
| `/.memory/rules.json` | All six collections | `:38`, `:201-219` |
| `/rules/*.json` | Rule sets loaded at `init`; written by `saveRulesToVFS(filename, rules)` | `:39`, `:127-199`, `:221` |
| `/rules/policies/*.json` | Policy sets; written by `savePoliciesToVFS` | `:40`, `:237` |

## Exports

Returned object at `rule-engine.js:1604-1659`, grouped as in the source:

| Group | Exports |
| --- | --- |
| Lifecycle | `init` (66) |
| Rules | `addRule` (313), `removeRule` (347), `getRules` (365), `getRule` (372), `setRuleEnabled` (380) |
| Constraints | `addConstraint` (400), `removeConstraint` (434), `getConstraints` (427) |
| Inference | `infer` (450), `queryWithInference` (530), `validate(facts?)` (552) |
| Induction | `induceRule` (612), `addExample` (671), `learnFromExamples(examples, { minSupport = 3, minConfidence = 0.7 })` (735), `getInducedRules`, `getExamples`, `clearExamples` |
| Policies | `addPolicy` (827), `removePolicy` (857), `getPolicies` (873), `checkPolicy(action)` (884), `enforcePolicy(action, onApproved, onDenied)` (964) |
| Agent rules | `addAgentRule` (1193), `removeAgentRule` (1233), `getAgentRules(tags)` (1250), `getAgentRule` (1263), `setAgentRuleEnabled` (1271), `evaluateAgentRules` (1290), `createContext(sources)` (1399), `registerActionHandler` (1128) |
| Persistence | `saveRulesToVFS`, `savePoliciesToVFS`, `exportRules` (1534), `importRules(data, merge = true)` (1549) |
| Utilities | `getStats` (1500), `clear` (1517, keeps built-ins) |

## Events

| Direction | Event | Line |
| --- | --- | --- |
| Listens | `cognition:symbolic:add` (triples trigger induction checks) | 104 |
| Emits | `cognition:symbolic:add` `{ type: 'rule', id }` | 336 |
| Emits | `cognition:symbolic:infer` `{ inputFacts, inferredFacts }` | 516 |
| Emits | `cognition:symbolic:validate` `{ valid, violations }` | 575 |
| Emits | `cognition:learning:rule` `{ id, rule }` | 641, 658 |
| Emits | `cognition:policy:triggered`, `cognition:policy:denied`, `cognition:policy:approved`, `cognition:policy:rejected` | 923, 931, 994, 1000 |
| Emits | `rule:agent:added`, `rule:agent:fired`, `rule:agent:evaluated` | 1222, 1359, 1378 |
| Emits | `rule:action:log`, `rule:action:setState`, `rule:action:tool`, and any event named by an `emit` action | 1038, 1053, 1077, 1064 |

## Related blueprints

- [0x000060 Knowledge Graph](0x000060-knowledge-graph.md): fact source and inference sink.
- [0x000049 Human-in-the-Loop Controller](0x000049-hitl-controller.md): approval for induced rules and policies.
- [0x000040 Verification Manager](0x000040-verification-manager.md): fallback approval path in `enforcePolicy`.
- [0x00004F Event Bus Infrastructure](0x00004F-event-bus-infrastructure.md).
