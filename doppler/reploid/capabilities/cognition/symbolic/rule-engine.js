/**
 * @fileoverview Rule Engine
 * Stratified Datalog-like inference engine for symbolic reasoning.
 * Supports forward chaining, constraint validation, and defeasible rules.
 */

const RuleEngine = {
  metadata: {
    id: 'RuleEngine',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'VFS', 'EventBus', 'KnowledgeGraph'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus, KnowledgeGraph } = deps;
    const { logger, generateId } = Utils;

    const STORE_PATH = '/.memory/rules.json';

    // Rule storage
    let _rules = [];
    let _constraints = [];
    let _inducedRules = []; // Auto-learned rules

    // --- Persistence ---

    const init = async () => {
      if (await VFS.exists(STORE_PATH)) {
        try {
          const content = await VFS.read(STORE_PATH);
          const data = JSON.parse(content);
          _rules = data.rules || [];
          _constraints = data.constraints || [];
          _inducedRules = data.inducedRules || [];
          logger.info(`[RuleEngine] Loaded ${_rules.length} rules, ${_constraints.length} constraints`);
        } catch (e) {
          logger.error('[RuleEngine] Corrupt store, starting fresh', e);
        }
      }

      // Add built-in rules
      addBuiltinRules();

      return true;
    };

    const save = async () => {
      if (!await VFS.exists('/.memory')) {
        await VFS.mkdir('/.memory');
      }
      await VFS.write(STORE_PATH, JSON.stringify({
        rules: _rules,
        constraints: _constraints,
        inducedRules: _inducedRules
      }, null, 2));
    };

    const addBuiltinRules = () => {
      // Transitivity rule for 'isA'
      if (!_rules.find(r => r.id === 'builtin-isa-transitive')) {
        _rules.push({
          id: 'builtin-isa-transitive',
          head: { predicate: 'isA', args: ['?x', '?z'] },
          body: [
            { predicate: 'isA', args: ['?x', '?y'] },
            { predicate: 'subClassOf', args: ['?y', '?z'] }
          ],
          priority: 100,
          builtin: true
        });
      }

      // Tool failure avoidance rule
      if (!_rules.find(r => r.id === 'builtin-avoid-failing-tool')) {
        _rules.push({
          id: 'builtin-avoid-failing-tool',
          head: { predicate: 'shouldAvoid', args: ['?tool'] },
          body: [
            { predicate: 'failedExecution', args: ['?tool', '?c1'] },
            { predicate: 'failedExecution', args: ['?tool', '?c2'] },
            { predicate: 'failedExecution', args: ['?tool', '?c3'] },
            { predicate: '!=', args: ['?c1', '?c2'] },
            { predicate: '!=', args: ['?c2', '?c3'] },
            { predicate: '!=', args: ['?c1', '?c3'] }
          ],
          priority: 80,
          builtin: true
        });
      }
    };

    // --- Rule Management ---

    const addRule = async (rule) => {
      const id = rule.id || generateId('rule');

      const entry = {
        id,
        head: rule.head,
        body: rule.body || [],
        priority: rule.priority || 50,
        confidence: rule.confidence || 1.0,
        source: rule.source || 'user',
        enabled: rule.enabled !== false
      };

      // Check for duplicate
      const existing = _rules.findIndex(r => r.id === id);
      if (existing >= 0) {
        _rules[existing] = entry;
      } else {
        _rules.push(entry);
      }

      await save();
      EventBus.emit('cognition:symbolic:add', { type: 'rule', id });
      logger.debug(`[RuleEngine] Added rule: ${id}`);

      return id;
    };

    const removeRule = async (id) => {
      const idx = _rules.findIndex(r => r.id === id);
      if (idx === -1) return false;

      if (_rules[idx].builtin) {
        logger.warn(`[RuleEngine] Cannot remove builtin rule: ${id}`);
        return false;
      }

      _rules.splice(idx, 1);
      await save();
      return true;
    };

    const getRules = () => _rules.filter(r => r.enabled);

    // --- Constraint Management ---

    const addConstraint = async (constraint) => {
      const id = constraint.id || generateId('cstr');

      const entry = {
        id,
        body: constraint.body,
        message: constraint.message || 'Constraint violated',
        severity: constraint.severity || 'error',
        enabled: constraint.enabled !== false
      };

      const existing = _constraints.findIndex(c => c.id === id);
      if (existing >= 0) {
        _constraints[existing] = entry;
      } else {
        _constraints.push(entry);
      }

      await save();
      return id;
    };

    const getConstraints = () => _constraints.filter(c => c.enabled);

    // --- Inference Engine ---

    const infer = async (maxIterations = 10) => {
      const allTriples = KnowledgeGraph.query({});
      let facts = allTriples.map(t => ({
        predicate: t.predicate,
        args: [t.subject, t.object],
        source: 'kb',
        confidence: t.metadata.confidence
      }));

      let newFacts = [...facts];
      let iteration = 0;

      while (iteration < maxIterations) {
        const derived = [];
        const rules = getRules().sort((a, b) => b.priority - a.priority);

        for (const rule of rules) {
          const bindings = matchRule(rule, newFacts);

          for (const binding of bindings) {
            const head = instantiate(rule.head, binding);

            // Check if fact already exists
            const exists = facts.some(f =>
              f.predicate === head.predicate &&
              arraysEqual(f.args, head.args)
            );

            if (!exists) {
              derived.push({
                ...head,
                source: 'inferred',
                rule: rule.id,
                confidence: rule.confidence * 0.9, // Slight decay for inferred facts
                bindings: binding
              });
            }
          }
        }

        if (derived.length === 0) break;

        // Add derived facts to KB
        for (const fact of derived) {
          if (fact.args.length === 2 && typeof fact.args[0] === 'string') {
            await KnowledgeGraph.addTriple(
              fact.args[0],
              fact.predicate,
              fact.args[1],
              {
                confidence: fact.confidence,
                source: 'inferred',
                provenance: [`Rule: ${fact.rule}`]
              }
            );
          }
        }

        facts = [...facts, ...derived];
        newFacts = derived;
        iteration++;
      }

      const inferredCount = facts.length - allTriples.length;
      if (inferredCount > 0) {
        logger.info(`[RuleEngine] Inferred ${inferredCount} new facts in ${iteration} iterations`);
        EventBus.emit('cognition:symbolic:infer', {
          inputFacts: allTriples.length,
          inferredFacts: inferredCount
        });
      }

      return facts;
    };

    const matchRule = (rule, facts) => {
      if (!rule.body || rule.body.length === 0) {
        return [{}]; // Empty body matches with empty binding
      }

      let bindings = [{}];

      for (const bodyAtom of rule.body) {
        const newBindings = [];

        for (const binding of bindings) {
          const matches = matchAtom(bodyAtom, facts, binding);
          newBindings.push(...matches);
        }

        bindings = newBindings;
        if (bindings.length === 0) break;
      }

      return bindings;
    };

    const matchAtom = (atom, facts, existingBinding) => {
      const bindings = [];

      // Handle built-in predicates
      if (atom.predicate === '!=') {
        const [a, b] = atom.args.map(arg => resolveArg(arg, existingBinding));
        if (a !== undefined && b !== undefined && a !== b) {
          bindings.push({ ...existingBinding });
        }
        return bindings;
      }

      if (atom.predicate === '=') {
        const [a, b] = atom.args.map(arg => resolveArg(arg, existingBinding));
        if (a !== undefined && b !== undefined && a === b) {
          bindings.push({ ...existingBinding });
        }
        return bindings;
      }

      // Match against facts
      for (const fact of facts) {
        if (fact.predicate !== atom.predicate) continue;
        if (atom.negated && fact) continue; // Simple negation-as-failure

        const newBinding = tryUnify(atom.args, fact.args, existingBinding);
        if (newBinding) {
          bindings.push(newBinding);
        }
      }

      // Handle negation-as-failure
      if (atom.negated && bindings.length === 0) {
        bindings.push({ ...existingBinding });
      }

      return bindings;
    };

    const tryUnify = (pattern, values, binding) => {
      if (pattern.length !== values.length) return null;

      const newBinding = { ...binding };

      for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i];
        const v = values[i];

        if (isVariable(p)) {
          if (p in newBinding) {
            if (newBinding[p] !== v) return null;
          } else {
            newBinding[p] = v;
          }
        } else {
          if (p !== v) return null;
        }
      }

      return newBinding;
    };

    const isVariable = (term) => typeof term === 'string' && term.startsWith('?');

    const resolveArg = (arg, binding) => {
      if (isVariable(arg)) {
        return binding[arg];
      }
      return arg;
    };

    const instantiate = (template, binding) => ({
      predicate: template.predicate,
      args: template.args.map(arg => resolveArg(arg, binding) || arg)
    });

    const arraysEqual = (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    };

    // --- Validation ---

    const validate = async (facts = null) => {
      if (!facts) {
        facts = KnowledgeGraph.query({}).map(t => ({
          predicate: t.predicate,
          args: [t.subject, t.object]
        }));
      }

      const violations = [];

      for (const constraint of getConstraints()) {
        const bindings = matchRule({ body: constraint.body }, facts);

        if (bindings.length > 0) {
          violations.push({
            constraint: constraint.id,
            message: constraint.message,
            severity: constraint.severity,
            bindings: bindings.slice(0, 5) // Limit examples
          });
        }
      }

      EventBus.emit('cognition:symbolic:validate', {
        valid: violations.filter(v => v.severity === 'error').length === 0,
        violations: violations.length
      });

      return {
        valid: violations.filter(v => v.severity === 'error').length === 0,
        violations,
        suggestions: generateSuggestions(violations)
      };
    };

    const generateSuggestions = (violations) => {
      return violations.map(v => ({
        constraint: v.constraint,
        action: 'review',
        message: `Review: ${v.message}`
      }));
    };

    // --- Rule Induction ---

    const induceRule = async (pattern) => {
      const id = generateId('induced');

      const rule = {
        id,
        head: pattern.head,
        body: pattern.body,
        priority: 30, // Lower priority than explicit rules
        confidence: pattern.confidence || 0.7,
        source: 'induced',
        support: pattern.support || 1,
        enabled: true
      };

      _inducedRules.push(rule);
      _rules.push(rule);

      await save();
      logger.info(`[RuleEngine] Induced new rule: ${id}`);
      EventBus.emit('cognition:learning:rule', { id, rule });

      return id;
    };

    const getInducedRules = () => _inducedRules;

    // --- Utilities ---

    const getStats = () => ({
      ruleCount: _rules.length,
      constraintCount: _constraints.length,
      inducedRuleCount: _inducedRules.length,
      enabledRules: _rules.filter(r => r.enabled).length
    });

    const clear = async () => {
      _rules = [];
      _constraints = [];
      _inducedRules = [];
      addBuiltinRules();
      await save();
      logger.info('[RuleEngine] Cleared all rules');
    };

    return {
      init,
      addRule,
      removeRule,
      getRules,
      addConstraint,
      getConstraints,
      infer,
      validate,
      induceRule,
      getInducedRules,
      getStats,
      clear
    };
  }
};

export default RuleEngine;
