/**
 * @fileoverview Rule Engine
 * Stratified Datalog-like inference engine for symbolic reasoning.
 * Supports forward chaining, constraint validation, defeasible rules,
 * rule induction from examples, policy enforcement integration,
 * and declarative agent rules with pattern matching and action execution.
 *
 * @module RuleEngine
 * @requires Utils
 * @requires VFS
 * @requires EventBus
 * @requires KnowledgeGraph
 */

import { isSecurityEnabled } from '../../../core/security-config.js';

const RuleEngine = {
  metadata: {
    id: 'RuleEngine',
    version: '3.0.0',
    genesis: { introduced: 'cognition' },
    dependencies: ['Utils', 'VFS', 'EventBus', 'KnowledgeGraph'],
    optional: ['HITLController', 'VerificationManager', 'ToolRunner', 'StateManager'],
    async: true,
    type: 'service'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus, KnowledgeGraph } = deps;
    const HITLController = deps.HITLController || null;
    const VerificationManager = deps.VerificationManager || null;
    const ToolRunner = deps.ToolRunner || null;
    const StateManager = deps.StateManager || null;
    const { logger, generateId } = Utils;

    const STORE_PATH = '/.memory/rules.json';
    const RULES_DIR = '/rules';
    const POLICY_DIR = '/rules/policies';

    // Rule storage
    let _rules = [];
    let _constraints = [];
    let _inducedRules = []; // Auto-learned rules
    let _policies = []; // Policy enforcement rules
    let _examples = []; // Training examples for rule induction
    let _agentRules = []; // Declarative agent rules with conditions and actions
    let _actionHandlers = new Map(); // Custom action handlers

    // HITL registration
    const HITL_MODULE_ID = 'RuleEngine';
    const HITL_CAPABILITIES = {
      APPROVE_RULE_CHANGES: 'approve_rule_changes',
      APPROVE_POLICY_ENFORCEMENT: 'approve_policy_enforcement',
      APPROVE_INDUCED_RULES: 'approve_induced_rules'
    };

    // --- Persistence ---

    /**
     * Initialize the rule engine.
     * Loads persisted rules from VFS and registers with HITL if available.
     * @returns {Promise<boolean>} True if initialization succeeded
     */
    const init = async () => {
      // Load from main store
      if (await VFS.exists(STORE_PATH)) {
        try {
          const content = await VFS.read(STORE_PATH);
          const data = JSON.parse(content);
          _rules = data.rules || [];
          _constraints = data.constraints || [];
          _inducedRules = data.inducedRules || [];
          _policies = data.policies || [];
          _agentRules = data.agentRules || [];
          _examples = data.examples || [];
          logger.info(`[RuleEngine] Loaded ${_rules.length} rules, ${_agentRules.length} agent rules, ${_constraints.length} constraints`);
        } catch (e) {
          logger.error('[RuleEngine] Corrupt store, starting fresh', e);
        }
      }

      // Load rules from VFS /rules/ directory
      await loadRulesFromVFS();

      // Register default action handlers
      registerDefaultActionHandlers();

      // Add built-in rules
      addBuiltinRules();
      addBuiltinAgentRules();

      // Register with HITL if available
      if (HITLController) {
        HITLController.registerModule(HITL_MODULE_ID, [
          HITL_CAPABILITIES.APPROVE_RULE_CHANGES,
          HITL_CAPABILITIES.APPROVE_POLICY_ENFORCEMENT,
          HITL_CAPABILITIES.APPROVE_INDUCED_RULES
        ], 'Rule Engine - symbolic inference and policy enforcement');
      }

      // Subscribe to relevant events
      EventBus.on('cognition:symbolic:add', handleSymbolicAdd, HITL_MODULE_ID);

      return true;
    };

    /**
     * Handle symbolic additions from KnowledgeGraph for potential rule induction.
     * @param {Object} event - The event data
     * @private
     */
    const handleSymbolicAdd = (event) => {
      // Track facts for potential rule induction
      if (event.type === 'triple') {
        checkForInductionOpportunity(event);
      }
    };

    /**
     * Load rules from VFS /rules/ directory.
     * Each .json file in the directory is loaded as a rule set.
     * @returns {Promise<number>} Number of rules loaded
     * @private
     */
    const loadRulesFromVFS = async () => {
      let loaded = 0;

      // Ensure directories exist
      if (!await VFS.exists(RULES_DIR)) {
        await VFS.mkdir(RULES_DIR);
      }
      if (!await VFS.exists(POLICY_DIR)) {
        await VFS.mkdir(POLICY_DIR);
      }

      // Load rule files
      try {
        const files = await VFS.list(RULES_DIR);
        for (const file of files) {
          if (file.endsWith('.json') && !file.includes('/policies/')) {
            try {
              const content = await VFS.read(file);
              const ruleSet = JSON.parse(content);
              if (Array.isArray(ruleSet.rules)) {
                for (const rule of ruleSet.rules) {
                  rule.source = rule.source || `vfs:${file}`;
                  if (!_rules.find(r => r.id === rule.id)) {
                    _rules.push(rule);
                    loaded++;
                  }
                }
              }
            } catch (e) {
              logger.warn(`[RuleEngine] Failed to load rule file: ${file}`, e);
            }
          }
        }
      } catch (e) {
        // Directory listing failed, ignore
      }

      // Load policy files
      try {
        const policyFiles = await VFS.list(POLICY_DIR);
        for (const file of policyFiles) {
          if (file.endsWith('.json')) {
            try {
              const content = await VFS.read(file);
              const policySet = JSON.parse(content);
              if (Array.isArray(policySet.policies)) {
                for (const policy of policySet.policies) {
                  policy.source = policy.source || `vfs:${file}`;
                  if (!_policies.find(p => p.id === policy.id)) {
                    _policies.push(policy);
                  }
                }
              }
            } catch (e) {
              logger.warn(`[RuleEngine] Failed to load policy file: ${file}`, e);
            }
          }
        }
      } catch (e) {
        // Directory listing failed, ignore
      }

      if (loaded > 0) {
        logger.info(`[RuleEngine] Loaded ${loaded} rules from VFS`);
      }

      return loaded;
    };

    /**
     * Save current state to VFS.
     * @returns {Promise<void>}
     * @private
     */
    const save = async () => {
      if (!await VFS.exists('/.memory')) {
        await VFS.mkdir('/.memory');
      }
      await VFS.write(STORE_PATH, JSON.stringify({
        rules: _rules.filter(r => !r.builtin), // Don't persist builtins
        constraints: _constraints,
        inducedRules: _inducedRules,
        policies: _policies,
        agentRules: _agentRules.filter(r => !r.builtin), // Don't persist builtins
        examples: _examples.slice(-1000) // Keep last 1000 examples
      }, null, 2));
    };

    /**
     * Save a rule set to a VFS file.
     * @param {string} filename - Name of the file (without path)
     * @param {Object[]} rules - Array of rules to save
     * @returns {Promise<string>} Path where rules were saved
     */
    const saveRulesToVFS = async (filename, rules) => {
      if (!await VFS.exists(RULES_DIR)) {
        await VFS.mkdir(RULES_DIR);
      }
      const path = `${RULES_DIR}/${filename}`;
      await VFS.write(path, JSON.stringify({ rules, savedAt: Date.now() }, null, 2));
      logger.info(`[RuleEngine] Saved ${rules.length} rules to ${path}`);
      return path;
    };

    /**
     * Save a policy set to a VFS file.
     * @param {string} filename - Name of the file (without path)
     * @param {Object[]} policies - Array of policies to save
     * @returns {Promise<string>} Path where policies were saved
     */
    const savePoliciesToVFS = async (filename, policies) => {
      if (!await VFS.exists(POLICY_DIR)) {
        await VFS.mkdir(POLICY_DIR);
      }
      const path = `${POLICY_DIR}/${filename}`;
      await VFS.write(path, JSON.stringify({ policies, savedAt: Date.now() }, null, 2));
      logger.info(`[RuleEngine] Saved ${policies.length} policies to ${path}`);
      return path;
    };

    /**
     * Add built-in rules that are always present.
     * @private
     */
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
          builtin: true,
          enabled: true
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
          builtin: true,
          enabled: true
        });
      }

      // Policy: require approval for substrate modifications
      if (!_policies.find(p => p.id === 'builtin-substrate-approval')) {
        _policies.push({
          id: 'builtin-substrate-approval',
          name: 'Substrate Modification Approval',
          trigger: { predicate: 'modifies', args: ['?action', 'substrate'] },
          action: 'require_approval',
          level: 'L3',
          builtin: true
        });
      }
    };

    // --- Rule Management ---

    /**
     * Add a new rule to the engine.
     * @param {Object} rule - The rule definition
     * @param {string} [rule.id] - Unique identifier (auto-generated if not provided)
     * @param {Object} rule.head - The conclusion (predicate and args)
     * @param {Object[]} [rule.body] - The conditions (array of predicates)
     * @param {number} [rule.priority=50] - Priority (higher = evaluated first)
     * @param {number} [rule.confidence=1.0] - Confidence level (0-1)
     * @param {string} [rule.source='user'] - Source of the rule
     * @param {boolean} [rule.enabled=true] - Whether the rule is active
     * @returns {Promise<string>} The rule ID
     */
    const addRule = async (rule) => {
      const id = rule.id || generateId('rule');

      const entry = {
        id,
        head: rule.head,
        body: rule.body || [],
        priority: rule.priority || 50,
        confidence: rule.confidence || 1.0,
        source: rule.source || 'user',
        enabled: rule.enabled !== false,
        createdAt: Date.now()
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

    /**
     * Remove a rule by ID.
     * @param {string} id - The rule ID to remove
     * @returns {Promise<boolean>} True if removed, false if not found or builtin
     */
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

    /**
     * Get all enabled rules.
     * @returns {Object[]} Array of enabled rules
     */
    const getRules = () => _rules.filter(r => r.enabled);

    /**
     * Get a rule by ID.
     * @param {string} id - The rule ID
     * @returns {Object|null} The rule or null if not found
     */
    const getRule = (id) => _rules.find(r => r.id === id) || null;

    /**
     * Enable or disable a rule.
     * @param {string} id - The rule ID
     * @param {boolean} enabled - Whether to enable or disable
     * @returns {Promise<boolean>} True if updated
     */
    const setRuleEnabled = async (id, enabled) => {
      const rule = _rules.find(r => r.id === id);
      if (!rule) return false;
      rule.enabled = enabled;
      await save();
      return true;
    };

    // --- Constraint Management ---

    /**
     * Add a constraint (integrity rule that should not be violated).
     * @param {Object} constraint - The constraint definition
     * @param {string} [constraint.id] - Unique identifier
     * @param {Object[]} constraint.body - Conditions that indicate violation
     * @param {string} [constraint.message] - Human-readable violation message
     * @param {string} [constraint.severity='error'] - 'error' or 'warning'
     * @param {boolean} [constraint.enabled=true] - Whether active
     * @returns {Promise<string>} The constraint ID
     */
    const addConstraint = async (constraint) => {
      const id = constraint.id || generateId('cstr');

      const entry = {
        id,
        body: constraint.body,
        message: constraint.message || 'Constraint violated',
        severity: constraint.severity || 'error',
        enabled: constraint.enabled !== false,
        createdAt: Date.now()
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

    /**
     * Get all enabled constraints.
     * @returns {Object[]} Array of enabled constraints
     */
    const getConstraints = () => _constraints.filter(c => c.enabled);

    /**
     * Remove a constraint by ID.
     * @param {string} id - The constraint ID
     * @returns {Promise<boolean>} True if removed
     */
    const removeConstraint = async (id) => {
      const idx = _constraints.findIndex(c => c.id === id);
      if (idx === -1) return false;
      _constraints.splice(idx, 1);
      await save();
      return true;
    };

    // --- Inference Engine ---

    /**
     * Run forward chaining inference to derive new facts.
     * Applies rules iteratively until no new facts are derived or max iterations reached.
     * @param {number} [maxIterations=10] - Maximum inference iterations
     * @returns {Promise<Object[]>} All facts (original + derived)
     */
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

    /**
     * Query the rule engine with a pattern, returning matching facts.
     * @param {Object} pattern - Query pattern with optional predicate, args
     * @returns {Promise<Object[]>} Matching facts from inference
     */
    const queryWithInference = async (pattern) => {
      const facts = await infer();
      return facts.filter(f => {
        if (pattern.predicate && f.predicate !== pattern.predicate) return false;
        if (pattern.args) {
          for (let i = 0; i < pattern.args.length; i++) {
            if (pattern.args[i] && !isVariable(pattern.args[i]) && pattern.args[i] !== f.args[i]) {
              return false;
            }
          }
        }
        return true;
      });
    };

    /**
     * Match a rule against facts, returning all valid bindings.
     * @param {Object} rule - The rule to match
     * @param {Object[]} facts - Available facts
     * @returns {Object[]} Array of variable bindings that satisfy the rule body
     * @private
     */
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

    /**
     * Match a single atom against facts with existing bindings.
     * @param {Object} atom - The atom to match
     * @param {Object[]} facts - Available facts
     * @param {Object} existingBinding - Current variable bindings
     * @returns {Object[]} Extended bindings that match the atom
     * @private
     */
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

    /**
     * Try to unify a pattern with values, extending the binding.
     * @param {Array} pattern - Pattern with possible variables
     * @param {Array} values - Concrete values
     * @param {Object} binding - Existing variable bindings
     * @returns {Object|null} Extended binding or null if unification fails
     * @private
     */
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

    /**
     * Check if a term is a variable (starts with '?').
     * @param {*} term - The term to check
     * @returns {boolean} True if variable
     * @private
     */
    const isVariable = (term) => typeof term === 'string' && term.startsWith('?');

    /**
     * Resolve an argument using current bindings.
     * @param {*} arg - The argument (variable or constant)
     * @param {Object} binding - Variable bindings
     * @returns {*} Resolved value
     * @private
     */
    const resolveArg = (arg, binding) => {
      if (isVariable(arg)) {
        return binding[arg];
      }
      return arg;
    };

    /**
     * Instantiate a template with variable bindings.
     * @param {Object} template - Template with predicate and args
     * @param {Object} binding - Variable bindings
     * @returns {Object} Instantiated predicate
     * @private
     */
    const instantiate = (template, binding) => ({
      predicate: template.predicate,
      args: template.args.map(arg => resolveArg(arg, binding) || arg)
    });

    /**
     * Check if two arrays are equal.
     * @param {Array} a - First array
     * @param {Array} b - Second array
     * @returns {boolean} True if equal
     * @private
     */
    const arraysEqual = (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    };

    // --- Validation ---

    /**
     * Validate facts against all enabled constraints.
     * @param {Object[]|null} [facts=null] - Facts to validate (defaults to KB triples)
     * @returns {Promise<Object>} Validation result with violations and suggestions
     */
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

    /**
     * Generate fix suggestions for constraint violations.
     * @param {Object[]} violations - Array of violations
     * @returns {Object[]} Suggested actions
     * @private
     */
    const generateSuggestions = (violations) => {
      return violations.map(v => ({
        constraint: v.constraint,
        action: 'review',
        message: `Review: ${v.message}`
      }));
    };

    // --- Rule Induction ---

    /**
     * Induce a rule from a pattern (typically from observed examples).
     * @param {Object} pattern - Rule pattern to induce
     * @param {Object} pattern.head - Rule conclusion
     * @param {Object[]} pattern.body - Rule conditions
     * @param {number} [pattern.confidence=0.7] - Initial confidence
     * @param {number} [pattern.support=1] - Supporting example count
     * @returns {Promise<string>} The induced rule ID
     */
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
        enabled: true,
        createdAt: Date.now()
      };

      // Request HITL approval if available and in HITL mode
      if (isSecurityEnabled() && HITLController &&
          HITLController.requiresApproval(HITL_MODULE_ID, HITL_CAPABILITIES.APPROVE_INDUCED_RULES)) {
        return new Promise((resolve, reject) => {
          HITLController.requestApproval({
            moduleId: HITL_MODULE_ID,
            capability: HITL_CAPABILITIES.APPROVE_INDUCED_RULES,
            action: `Induce rule: ${pattern.head.predicate}`,
            data: rule,
            onApprove: async (approvedRule) => {
              _inducedRules.push(approvedRule);
              _rules.push(approvedRule);
              await save();
              logger.info(`[RuleEngine] Induced new rule (approved): ${id}`);
              EventBus.emit('cognition:learning:rule', { id, rule: approvedRule });
              resolve(id);
            },
            onReject: (reason) => {
              logger.info(`[RuleEngine] Rule induction rejected: ${reason}`);
              reject(new Error(`Rule induction rejected: ${reason}`));
            },
            timeout: 60000 // 1 minute timeout
          });
        });
      }

      _inducedRules.push(rule);
      _rules.push(rule);

      await save();
      logger.info(`[RuleEngine] Induced new rule: ${id}`);
      EventBus.emit('cognition:learning:rule', { id, rule });

      return id;
    };

    /**
     * Add a training example for rule induction.
     * @param {Object} example - The example
     * @param {Object} example.input - Input facts
     * @param {Object} example.output - Expected output/conclusion
     * @param {boolean} [example.positive=true] - Whether this is a positive example
     * @returns {Promise<void>}
     */
    const addExample = async (example) => {
      _examples.push({
        ...example,
        positive: example.positive !== false,
        timestamp: Date.now()
      });
      await save();

      // Check if we have enough examples to induce a rule
      await checkForInductionOpportunity({ type: 'example', example });
    };

    /**
     * Check if there's an opportunity to induce a new rule from examples.
     * @param {Object} event - The triggering event
     * @private
     */
    const checkForInductionOpportunity = async (event) => {
      // Simple heuristic: look for repeated patterns in examples
      const positiveExamples = _examples.filter(e => e.positive);
      if (positiveExamples.length < 3) return; // Need at least 3 examples

      // Group examples by output predicate
      const byPredicate = new Map();
      for (const example of positiveExamples) {
        if (example.output?.predicate) {
          if (!byPredicate.has(example.output.predicate)) {
            byPredicate.set(example.output.predicate, []);
          }
          byPredicate.get(example.output.predicate).push(example);
        }
      }

      // For each predicate with enough examples, try to find common patterns
      for (const [predicate, examples] of byPredicate) {
        if (examples.length >= 3) {
          const pattern = findCommonPattern(examples);
          if (pattern && pattern.body.length > 0) {
            // Check if we already have this rule
            const exists = _rules.some(r =>
              r.head.predicate === pattern.head.predicate &&
              JSON.stringify(r.body) === JSON.stringify(pattern.body)
            );

            if (!exists) {
              await induceRule({
                ...pattern,
                confidence: Math.min(0.9, 0.5 + examples.length * 0.1),
                support: examples.length
              });
            }
          }
        }
      }
    };

    /**
     * Find common pattern across examples (simple heuristic approach).
     * @param {Object[]} examples - Positive examples
     * @returns {Object|null} Common pattern or null
     * @private
     */
    const findCommonPattern = (examples) => {
      if (examples.length === 0) return null;

      // Use first example as template
      const first = examples[0];
      if (!first.output || !first.input) return null;

      // Find predicates that appear in all examples' inputs
      const commonPredicates = new Set();
      if (Array.isArray(first.input)) {
        for (const fact of first.input) {
          commonPredicates.add(fact.predicate);
        }
      }

      for (const example of examples.slice(1)) {
        if (!Array.isArray(example.input)) continue;
        const predicates = new Set(example.input.map(f => f.predicate));
        for (const p of commonPredicates) {
          if (!predicates.has(p)) {
            commonPredicates.delete(p);
          }
        }
      }

      if (commonPredicates.size === 0) return null;

      // Build rule body from common predicates (simplified)
      const body = Array.from(commonPredicates).map(pred => ({
        predicate: pred,
        args: ['?x', '?y'] // Generic pattern
      }));

      return {
        head: {
          predicate: first.output.predicate,
          args: first.output.args?.map((_, i) => `?arg${i}`) || ['?x']
        },
        body
      };
    };

    /**
     * Learn rules from a batch of examples using simple induction.
     * @param {Object[]} examples - Training examples
     * @param {Object} [options] - Learning options
     * @param {number} [options.minSupport=3] - Minimum examples for rule
     * @param {number} [options.minConfidence=0.7] - Minimum confidence threshold
     * @returns {Promise<string[]>} IDs of induced rules
     */
    const learnFromExamples = async (examples, options = {}) => {
      const { minSupport = 3, minConfidence = 0.7 } = options;
      const inducedIds = [];

      // Add all examples
      for (const example of examples) {
        _examples.push({
          ...example,
          positive: example.positive !== false,
          timestamp: Date.now()
        });
      }

      // Group by output predicate
      const positiveExamples = _examples.filter(e => e.positive);
      const byPredicate = new Map();

      for (const example of positiveExamples) {
        if (example.output?.predicate) {
          if (!byPredicate.has(example.output.predicate)) {
            byPredicate.set(example.output.predicate, []);
          }
          byPredicate.get(example.output.predicate).push(example);
        }
      }

      // Induce rules for predicates with enough support
      for (const [predicate, exs] of byPredicate) {
        if (exs.length >= minSupport) {
          const pattern = findCommonPattern(exs);
          if (pattern) {
            const confidence = Math.min(0.95, 0.5 + exs.length * 0.1);
            if (confidence >= minConfidence) {
              const exists = _rules.some(r =>
                r.head.predicate === pattern.head.predicate &&
                JSON.stringify(r.body) === JSON.stringify(pattern.body)
              );

              if (!exists) {
                try {
                  const id = await induceRule({
                    ...pattern,
                    confidence,
                    support: exs.length
                  });
                  inducedIds.push(id);
                } catch (e) {
                  logger.warn(`[RuleEngine] Failed to induce rule: ${e.message}`);
                }
              }
            }
          }
        }
      }

      await save();
      return inducedIds;
    };

    /**
     * Get all induced rules.
     * @returns {Object[]} Array of induced rules
     */
    const getInducedRules = () => [..._inducedRules];

    /**
     * Get training examples.
     * @returns {Object[]} Array of examples
     */
    const getExamples = () => [..._examples];

    /**
     * Clear training examples.
     * @returns {Promise<void>}
     */
    const clearExamples = async () => {
      _examples = [];
      await save();
    };

    // --- Policy Enforcement ---

    /**
     * Add a policy for enforcement.
     * @param {Object} policy - Policy definition
     * @param {string} [policy.id] - Unique identifier
     * @param {string} policy.name - Human-readable name
     * @param {Object} policy.trigger - Condition that triggers the policy
     * @param {string} policy.action - Action to take ('require_approval', 'deny', 'log')
     * @param {string} [policy.level] - RSI level ('L1', 'L2', 'L3')
     * @returns {Promise<string>} The policy ID
     */
    const addPolicy = async (policy) => {
      const id = policy.id || generateId('policy');

      const entry = {
        id,
        name: policy.name || id,
        trigger: policy.trigger,
        action: policy.action || 'log',
        level: policy.level || 'L1',
        enabled: policy.enabled !== false,
        createdAt: Date.now()
      };

      const existing = _policies.findIndex(p => p.id === id);
      if (existing >= 0) {
        _policies[existing] = entry;
      } else {
        _policies.push(entry);
      }

      await save();
      logger.info(`[RuleEngine] Added policy: ${id}`);
      return id;
    };

    /**
     * Remove a policy by ID.
     * @param {string} id - Policy ID
     * @returns {Promise<boolean>} True if removed
     */
    const removePolicy = async (id) => {
      const idx = _policies.findIndex(p => p.id === id);
      if (idx === -1) return false;
      if (_policies[idx].builtin) {
        logger.warn(`[RuleEngine] Cannot remove builtin policy: ${id}`);
        return false;
      }
      _policies.splice(idx, 1);
      await save();
      return true;
    };

    /**
     * Get all enabled policies.
     * @returns {Object[]} Array of policies
     */
    const getPolicies = () => _policies.filter(p => p.enabled);

    /**
     * Check if an action is allowed by policies.
     * Returns the enforcement result with any required approvals.
     * @param {Object} action - The action to check
     * @param {string} action.type - Action type (e.g., 'write', 'execute')
     * @param {string} action.target - Target of the action
     * @param {Object} [action.metadata] - Additional metadata
     * @returns {Promise<Object>} Enforcement result
     */
    const checkPolicy = async (action) => {
      const facts = [
        { predicate: 'action', args: [action.type, action.target] },
        ...(action.metadata?.facts || [])
      ];

      // Add action type facts
      if (action.type === 'write' && action.target) {
        if (action.target.startsWith('/core/') || action.target.includes('agent-loop')) {
          facts.push({ predicate: 'modifies', args: [action.type, 'substrate'] });
        }
      }

      const triggered = [];
      for (const policy of getPolicies()) {
        // Check if policy trigger matches
        const triggerFact = { predicate: policy.trigger.predicate, args: policy.trigger.args };
        const bindings = matchAtom(triggerFact, facts, {});

        if (bindings.length > 0) {
          triggered.push({
            policy,
            bindings: bindings[0]
          });
        }
      }

      if (triggered.length === 0) {
        return { allowed: true, policies: [], requiresApproval: false };
      }

      // Process triggered policies
      const denials = triggered.filter(t => t.policy.action === 'deny');
      const approvals = triggered.filter(t => t.policy.action === 'require_approval');
      const logs = triggered.filter(t => t.policy.action === 'log');

      // Log any log-only policies
      for (const log of logs) {
        logger.info(`[RuleEngine] Policy triggered (log): ${log.policy.name}`, { action });
        EventBus.emit('cognition:policy:triggered', {
          policy: log.policy.id,
          action,
          outcome: 'logged'
        });
      }

      if (denials.length > 0) {
        EventBus.emit('cognition:policy:denied', {
          policies: denials.map(d => d.policy.id),
          action
        });
        return {
          allowed: false,
          policies: denials.map(d => d.policy),
          reason: `Denied by policy: ${denials[0].policy.name}`,
          requiresApproval: false
        };
      }

      if (approvals.length > 0) {
        return {
          allowed: false,
          policies: approvals.map(a => a.policy),
          requiresApproval: true,
          approvalLevel: Math.max(...approvals.map(a =>
            a.policy.level === 'L3' ? 3 : a.policy.level === 'L2' ? 2 : 1
          ))
        };
      }

      return { allowed: true, policies: logs.map(l => l.policy), requiresApproval: false };
    };

    /**
     * Enforce policy on an action, integrating with HITL/VerificationManager.
     * @param {Object} action - Action to enforce
     * @param {Function} [onApproved] - Callback when approved
     * @param {Function} [onDenied] - Callback when denied
     * @returns {Promise<Object>} Enforcement result
     */
    const enforcePolicy = async (action, onApproved = null, onDenied = null) => {
      const result = await checkPolicy(action);

      if (result.allowed) {
        if (onApproved) onApproved(result);
        return result;
      }

      if (!result.requiresApproval) {
        if (onDenied) onDenied(result.reason);
        return result;
      }

      if (!isSecurityEnabled()) {
        const approved = { ...result, allowed: true, approved: false, securityDisabled: true };
        if (onApproved) onApproved(approved);
        return approved;
      }

      // Requires approval - use HITL if available
      if (HITLController) {
        return new Promise((resolve) => {
          HITLController.requestApproval({
            moduleId: HITL_MODULE_ID,
            capability: HITL_CAPABILITIES.APPROVE_POLICY_ENFORCEMENT,
            action: `Policy approval: ${result.policies[0]?.name || 'Unknown'}`,
            data: { action, policies: result.policies },
            onApprove: () => {
              const approved = { ...result, allowed: true, approved: true };
              if (onApproved) onApproved(approved);
              EventBus.emit('cognition:policy:approved', { action, policies: result.policies });
              resolve(approved);
            },
            onReject: (reason) => {
              const denied = { ...result, allowed: false, reason };
              if (onDenied) onDenied(reason);
              EventBus.emit('cognition:policy:rejected', { action, reason });
              resolve(denied);
            },
            timeout: 120000 // 2 minute timeout
          });
        });
      }

      // No HITL, use VerificationManager if available
      if (VerificationManager && action.changes && isSecurityEnabled()) {
        const verification = await VerificationManager.verifyProposal(action.changes);
        if (verification.passed) {
          const approved = { ...result, allowed: true, verified: true };
          if (onApproved) onApproved(approved);
          return approved;
        } else {
          const denied = { ...result, allowed: false, reason: verification.reason };
          if (onDenied) onDenied(verification.reason);
          return denied;
        }
      }

      // No approval mechanism, deny by default for safety
      if (onDenied) onDenied('No approval mechanism available');
      return { ...result, allowed: false, reason: 'No approval mechanism available' };
    };

    // --- Agent Rules: Declarative Rules with Conditions and Actions ---

    /**
     * Register default action handlers for agent rules.
     * @private
     */
    const registerDefaultActionHandlers = () => {
      // Log action - simply logs a message
      _actionHandlers.set('log', async (params, context) => {
        const message = resolveTemplate(params.message || params, context);
        logger.info(`[RuleEngine:Action] ${message}`);
        EventBus.emit('rule:action:log', { message, context });
        return { success: true, message };
      });

      // Set state action - updates StateManager
      _actionHandlers.set('setState', async (params, context) => {
        if (!StateManager) {
          return { success: false, error: 'StateManager not available' };
        }
        const key = resolveTemplate(params.key, context);
        const value = resolveValue(params.value, context);
        try {
          const state = StateManager.getState();
          const newState = setNestedValue(state, key, value);
          StateManager.setState(newState);
          EventBus.emit('rule:action:setState', { key, value });
          return { success: true, key, value };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });

      // Emit event action
      _actionHandlers.set('emit', async (params, context) => {
        const event = resolveTemplate(params.event, context);
        const data = resolveValue(params.data || {}, context);
        EventBus.emit(event, data);
        return { success: true, event, data };
      });

      // Execute tool action
      _actionHandlers.set('executeTool', async (params, context) => {
        if (!ToolRunner) {
          return { success: false, error: 'ToolRunner not available' };
        }
        const toolName = resolveTemplate(params.tool, context);
        const args = resolveValue(params.args || {}, context);
        try {
          const result = await ToolRunner.execute(toolName, args);
          EventBus.emit('rule:action:tool', { tool: toolName, args, result });
          return { success: true, tool: toolName, result };
        } catch (e) {
          return { success: false, error: e.message, tool: toolName };
        }
      });

      // Add fact to KnowledgeGraph
      _actionHandlers.set('addFact', async (params, context) => {
        const subject = resolveTemplate(params.subject, context);
        const predicate = resolveTemplate(params.predicate, context);
        const object = resolveTemplate(params.object, context);
        const metadata = resolveValue(params.metadata || {}, context);
        try {
          const id = await KnowledgeGraph.addTriple(subject, predicate, object, metadata);
          return { success: true, id };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });

      // Compound action - execute multiple actions in sequence
      _actionHandlers.set('sequence', async (params, context) => {
        const results = [];
        for (const action of (params.actions || [])) {
          const result = await executeAction(action, context);
          results.push(result);
          if (!result.success && params.stopOnError !== false) {
            return { success: false, results, stoppedAt: results.length - 1 };
          }
        }
        return { success: true, results };
      });

      // Conditional action - execute based on condition
      _actionHandlers.set('conditional', async (params, context) => {
        const conditionMet = matchCondition(params.condition, context);
        if (conditionMet) {
          return await executeAction(params.then, context);
        } else if (params.else) {
          return await executeAction(params.else, context);
        }
        return { success: true, skipped: true };
      });
    };

    /**
     * Register a custom action handler.
     * @param {string} name - Action type name
     * @param {Function} handler - Handler function (params, context) => Promise<result>
     */
    const registerActionHandler = (name, handler) => {
      if (typeof handler !== 'function') {
        throw new Error('Action handler must be a function');
      }
      _actionHandlers.set(name, handler);
      logger.debug(`[RuleEngine] Registered action handler: ${name}`);
    };

    /**
     * Get a nested value from an object using dot notation or array path.
     * Supports wildcards (*) for array matching.
     * @param {Object} obj - The object to query
     * @param {string|string[]} path - Path like "a.b.c" or ["a", "b", "c"]
     * @returns {*} The value at the path or undefined
     * @private
     */
    const getNestedValue = (obj, path) => {
      if (!obj || !path) return undefined;
      const parts = Array.isArray(path) ? path : path.split('.');
      let current = obj;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (current === null || current === undefined) {
          return undefined;
        }

        // Handle array wildcard
        if (part === '*' && Array.isArray(current)) {
          const remainingPath = parts.slice(i + 1);
          if (remainingPath.length === 0) {
            return current;
          }
          return current.map(item => getNestedValue(item, remainingPath));
        }

        // Handle array index
        if (/^\d+$/.test(part)) {
          current = current[parseInt(part, 10)];
        } else {
          current = current[part];
        }
      }

      return current;
    };

    /**
     * Set a nested value in an object using dot notation.
     * @param {Object} obj - The object to modify
     * @param {string} path - Path like "a.b.c"
     * @param {*} value - Value to set
     * @returns {Object} Modified object (new reference)
     * @private
     */
    const setNestedValue = (obj, path, value) => {
      const parts = path.split('.');
      const result = JSON.parse(JSON.stringify(obj || {}));
      let current = result;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!(part in current) || typeof current[part] !== 'object') {
          current[part] = /^\d+$/.test(parts[i + 1]) ? [] : {};
        }
        current = current[part];
      }

      current[parts[parts.length - 1]] = value;
      return result;
    };

    /**
     * Resolve a template string with context values.
     * Supports ${path} syntax for variable interpolation.
     * @param {string} template - Template string
     * @param {Object} context - Context object for variable resolution
     * @returns {string} Resolved string
     * @private
     */
    const resolveTemplate = (template, context) => {
      if (typeof template !== 'string') return template;
      return template.replace(/\$\{([^}]+)\}/g, (match, path) => {
        const value = getNestedValue(context, path.trim());
        return value !== undefined ? String(value) : match;
      });
    };

    /**
     * Resolve a value that may contain template references.
     * Recursively processes objects and arrays.
     * @param {*} value - Value to resolve
     * @param {Object} context - Context object
     * @returns {*} Resolved value
     * @private
     */
    const resolveValue = (value, context) => {
      if (typeof value === 'string') {
        // Check if entire string is a variable reference
        const varMatch = value.match(/^\$\{([^}]+)\}$/);
        if (varMatch) {
          return getNestedValue(context, varMatch[1].trim());
        }
        return resolveTemplate(value, context);
      }
      if (Array.isArray(value)) {
        return value.map(v => resolveValue(v, context));
      }
      if (value && typeof value === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(value)) {
          result[resolveTemplate(k, context)] = resolveValue(v, context);
        }
        return result;
      }
      return value;
    };

    /**
     * Match a single condition against context.
     * Supports various operators: eq, neq, gt, gte, lt, lte, in, nin,
     * contains, startsWith, endsWith, matches, exists, typeof, and, or, not.
     * @param {Object} condition - Condition object
     * @param {Object} context - Context to match against
     * @returns {boolean} True if condition matches
     * @private
     */
    const matchCondition = (condition, context) => {
      if (!condition || typeof condition !== 'object') {
        return Boolean(condition);
      }

      // Handle logical operators
      if ('and' in condition) {
        return condition.and.every(c => matchCondition(c, context));
      }
      if ('or' in condition) {
        return condition.or.some(c => matchCondition(c, context));
      }
      if ('not' in condition) {
        return !matchCondition(condition.not, context);
      }

      // Get the path and actual value from context
      const path = condition.path || condition.field;
      if (!path) {
        // Direct value comparison
        if ('value' in condition && 'eq' in condition) {
          return condition.value === condition.eq;
        }
        return false;
      }

      const actualValue = getNestedValue(context, path);
      const expectedValue = resolveValue(condition.value, context);

      // Handle operators
      const op = condition.op || condition.operator || 'eq';

      switch (op) {
        case 'eq':
        case 'equals':
        case '==':
          return actualValue === expectedValue;

        case 'neq':
        case 'notEquals':
        case '!=':
          return actualValue !== expectedValue;

        case 'gt':
        case '>':
          return actualValue > expectedValue;

        case 'gte':
        case '>=':
          return actualValue >= expectedValue;

        case 'lt':
        case '<':
          return actualValue < expectedValue;

        case 'lte':
        case '<=':
          return actualValue <= expectedValue;

        case 'in':
          return Array.isArray(expectedValue) && expectedValue.includes(actualValue);

        case 'nin':
        case 'notIn':
          return !Array.isArray(expectedValue) || !expectedValue.includes(actualValue);

        case 'contains':
          if (Array.isArray(actualValue)) {
            return actualValue.includes(expectedValue);
          }
          if (typeof actualValue === 'string') {
            return actualValue.includes(String(expectedValue));
          }
          return false;

        case 'startsWith':
          return typeof actualValue === 'string' && actualValue.startsWith(String(expectedValue));

        case 'endsWith':
          return typeof actualValue === 'string' && actualValue.endsWith(String(expectedValue));

        case 'matches':
        case 'regex':
          try {
            const regex = expectedValue instanceof RegExp
              ? expectedValue
              : new RegExp(expectedValue);
            return regex.test(String(actualValue));
          } catch {
            return false;
          }

        case 'exists':
          return expectedValue ? actualValue !== undefined : actualValue === undefined;

        case 'typeof':
          return typeof actualValue === expectedValue;

        case 'isEmpty':
          if (expectedValue) {
            return actualValue === null || actualValue === undefined ||
                   actualValue === '' ||
                   (Array.isArray(actualValue) && actualValue.length === 0) ||
                   (typeof actualValue === 'object' && Object.keys(actualValue).length === 0);
          }
          return !(actualValue === null || actualValue === undefined ||
                  actualValue === '' ||
                  (Array.isArray(actualValue) && actualValue.length === 0) ||
                  (typeof actualValue === 'object' && Object.keys(actualValue).length === 0));

        case 'hasProperty':
          return actualValue && typeof actualValue === 'object' && expectedValue in actualValue;

        default:
          // Default to equality check
          return actualValue === expectedValue;
      }
    };

    /**
     * Match all conditions of an agent rule against context.
     * @param {Object[]} conditions - Array of conditions
     * @param {Object} context - Context to match against
     * @returns {boolean} True if all conditions match
     * @private
     */
    const matchAllConditions = (conditions, context) => {
      if (!Array.isArray(conditions) || conditions.length === 0) {
        return true; // No conditions = always matches
      }
      return conditions.every(condition => matchCondition(condition, context));
    };

    /**
     * Execute an action.
     * @param {Object} action - Action to execute
     * @param {Object} context - Execution context
     * @returns {Promise<Object>} Action result
     * @private
     */
    const executeAction = async (action, context) => {
      if (!action || typeof action !== 'object') {
        return { success: false, error: 'Invalid action' };
      }

      const actionType = action.type || action.action;
      const handler = _actionHandlers.get(actionType);

      if (!handler) {
        logger.warn(`[RuleEngine] Unknown action type: ${actionType}`);
        return { success: false, error: `Unknown action type: ${actionType}` };
      }

      try {
        const result = await handler(action.params || action, context);
        return result;
      } catch (e) {
        logger.error(`[RuleEngine] Action ${actionType} failed:`, e);
        return { success: false, error: e.message, actionType };
      }
    };

    /**
     * Add a declarative agent rule.
     * @param {Object} rule - Rule definition
     * @param {string} [rule.id] - Unique identifier
     * @param {string} [rule.name] - Human-readable name
     * @param {string} [rule.description] - Rule description
     * @param {Object[]} rule.conditions - Array of conditions to match
     * @param {Object|Object[]} rule.actions - Action(s) to execute when conditions match
     * @param {number} [rule.priority=50] - Priority (higher = evaluated first)
     * @param {boolean} [rule.enabled=true] - Whether rule is active
     * @param {boolean} [rule.once=false] - Only fire once per context
     * @param {string[]} [rule.tags=[]] - Tags for categorization
     * @returns {Promise<string>} Rule ID
     */
    const addAgentRule = async (rule) => {
      const id = rule.id || generateId('arule');

      const entry = {
        id,
        name: rule.name || id,
        description: rule.description || '',
        conditions: rule.conditions || [],
        actions: Array.isArray(rule.actions) ? rule.actions : [rule.actions],
        priority: rule.priority ?? 50,
        enabled: rule.enabled !== false,
        once: rule.once === true,
        tags: rule.tags || [],
        createdAt: Date.now(),
        firedCount: 0,
        lastFired: null
      };

      const existing = _agentRules.findIndex(r => r.id === id);
      if (existing >= 0) {
        _agentRules[existing] = { ..._agentRules[existing], ...entry, firedCount: _agentRules[existing].firedCount };
      } else {
        _agentRules.push(entry);
      }

      // Sort by priority (descending)
      _agentRules.sort((a, b) => b.priority - a.priority);

      await save();
      EventBus.emit('rule:agent:added', { id, name: entry.name });
      logger.debug(`[RuleEngine] Added agent rule: ${id} (priority: ${entry.priority})`);

      return id;
    };

    /**
     * Remove an agent rule by ID.
     * @param {string} id - Rule ID
     * @returns {Promise<boolean>} True if removed
     */
    const removeAgentRule = async (id) => {
      const idx = _agentRules.findIndex(r => r.id === id);
      if (idx === -1) return false;
      if (_agentRules[idx].builtin) {
        logger.warn(`[RuleEngine] Cannot remove builtin agent rule: ${id}`);
        return false;
      }
      _agentRules.splice(idx, 1);
      await save();
      return true;
    };

    /**
     * Get all enabled agent rules, sorted by priority.
     * @param {string[]} [tags] - Filter by tags (optional)
     * @returns {Object[]} Array of enabled rules
     */
    const getAgentRules = (tags = null) => {
      let rules = _agentRules.filter(r => r.enabled);
      if (tags && tags.length > 0) {
        rules = rules.filter(r => tags.some(t => r.tags.includes(t)));
      }
      return rules;
    };

    /**
     * Get an agent rule by ID.
     * @param {string} id - Rule ID
     * @returns {Object|null} Rule or null
     */
    const getAgentRule = (id) => _agentRules.find(r => r.id === id) || null;

    /**
     * Enable or disable an agent rule.
     * @param {string} id - Rule ID
     * @param {boolean} enabled - Enable/disable
     * @returns {Promise<boolean>} Success
     */
    const setAgentRuleEnabled = async (id, enabled) => {
      const rule = _agentRules.find(r => r.id === id);
      if (!rule) return false;
      rule.enabled = enabled;
      await save();
      return true;
    };

    /**
     * Evaluate all agent rules against a context and execute matching actions.
     * Rules are evaluated in priority order. Each rule can optionally stop propagation.
     * @param {Object} context - Context object containing agent state, message, etc.
     * @param {Object} [options] - Evaluation options
     * @param {string[]} [options.tags] - Only evaluate rules with these tags
     * @param {boolean} [options.dryRun=false] - If true, don't execute actions
     * @param {number} [options.maxRules] - Maximum number of rules to fire
     * @param {boolean} [options.stopOnFirst=false] - Stop after first matching rule
     * @returns {Promise<Object>} Evaluation result with fired rules and action results
     */
    const evaluateAgentRules = async (context, options = {}) => {
      const { tags = null, dryRun = false, maxRules = Infinity, stopOnFirst = false } = options;
      const startTime = Date.now();

      const rules = getAgentRules(tags);
      const results = {
        evaluated: 0,
        matched: 0,
        fired: [],
        skipped: [],
        actionResults: [],
        dryRun,
        duration: 0
      };

      // Track which "once" rules have already fired in this evaluation
      const onceFired = new Set();

      for (const rule of rules) {
        if (results.matched >= maxRules) break;
        results.evaluated++;

        // Check if "once" rule has already fired
        if (rule.once && (rule.lastFired || onceFired.has(rule.id))) {
          results.skipped.push({ id: rule.id, reason: 'once' });
          continue;
        }

        // Match conditions
        const matches = matchAllConditions(rule.conditions, context);

        if (matches) {
          results.matched++;

          if (rule.once) {
            onceFired.add(rule.id);
          }

          if (dryRun) {
            results.fired.push({
              id: rule.id,
              name: rule.name,
              actions: rule.actions,
              dryRun: true
            });
          } else {
            // Execute actions
            const actionResults = [];
            for (const action of rule.actions) {
              const result = await executeAction(action, context);
              actionResults.push({ action, result });

              // Check for stop propagation
              if (result.stopPropagation) {
                break;
              }
            }

            // Update rule stats
            rule.firedCount++;
            rule.lastFired = Date.now();

            results.fired.push({
              id: rule.id,
              name: rule.name,
              actionResults
            });
            results.actionResults.push(...actionResults);

            EventBus.emit('rule:agent:fired', {
              id: rule.id,
              name: rule.name,
              context: Object.keys(context),
              actionCount: actionResults.length
            });
          }

          if (stopOnFirst) break;
        }
      }

      results.duration = Date.now() - startTime;

      // Save updated fire counts
      if (results.matched > 0 && !dryRun) {
        save().catch(e => logger.warn('[RuleEngine] Failed to save after rule evaluation:', e.message));
      }

      EventBus.emit('rule:agent:evaluated', {
        evaluated: results.evaluated,
        matched: results.matched,
        duration: results.duration
      });

      return results;
    };

    /**
     * Create a context object for agent rule evaluation.
     * Combines various sources into a unified context.
     * @param {Object} sources - Context sources
     * @param {Object} [sources.state] - Agent state
     * @param {Object} [sources.message] - Current message
     * @param {Object} [sources.tool] - Tool call info
     * @param {Object} [sources.response] - LLM response
     * @param {Object} [sources.cycle] - Cycle info
     * @param {Object} [sources.custom] - Custom data
     * @returns {Object} Unified context object
     */
    const createContext = (sources = {}) => {
      const context = {
        timestamp: Date.now(),
        ...sources.custom
      };

      if (sources.state) {
        context.state = sources.state;
      } else if (StateManager) {
        context.state = StateManager.getState();
      }

      if (sources.message) {
        context.message = sources.message;
      }

      if (sources.tool) {
        context.tool = sources.tool;
      }

      if (sources.response) {
        context.response = sources.response;
      }

      if (sources.cycle !== undefined) {
        context.cycle = sources.cycle;
      }

      return context;
    };

    /**
     * Add built-in agent rules for common patterns.
     * @private
     */
    const addBuiltinAgentRules = () => {
      // Rule: Log warning when cycle count is high
      if (!_agentRules.find(r => r.id === 'builtin-high-cycle-warning')) {
        _agentRules.push({
          id: 'builtin-high-cycle-warning',
          name: 'High Cycle Warning',
          description: 'Warn when cycle count exceeds threshold',
          conditions: [
            { path: 'cycle', op: 'gte', value: 40 }
          ],
          actions: [
            {
              type: 'log',
              params: { message: 'Warning: High cycle count (${cycle}). Consider summarizing progress.' }
            },
            {
              type: 'emit',
              params: { event: 'agent:warning', data: { type: 'high_cycle', cycle: '${cycle}' } }
            }
          ],
          priority: 90,
          enabled: true,
          once: true,
          tags: ['agent', 'warning'],
          builtin: true,
          firedCount: 0,
          lastFired: null
        });
      }

      // Rule: Track tool errors for circuit breaker pattern
      if (!_agentRules.find(r => r.id === 'builtin-tool-error-tracking')) {
        _agentRules.push({
          id: 'builtin-tool-error-tracking',
          name: 'Tool Error Tracking',
          description: 'Track tool execution errors',
          conditions: [
            { path: 'tool.error', op: 'exists', value: true }
          ],
          actions: [
            {
              type: 'addFact',
              params: {
                subject: '${tool.name}',
                predicate: 'failedExecution',
                object: '${cycle}',
                metadata: { error: '${tool.error}', timestamp: '${timestamp}' }
              }
            }
          ],
          priority: 100,
          enabled: true,
          tags: ['tool', 'error'],
          builtin: true,
          firedCount: 0,
          lastFired: null
        });
      }
    };

    // --- Utilities ---

    /**
     * Get engine statistics.
     * @returns {Object} Statistics object
     */
    const getStats = () => ({
      ruleCount: _rules.length,
      constraintCount: _constraints.length,
      inducedRuleCount: _inducedRules.length,
      policyCount: _policies.length,
      agentRuleCount: _agentRules.length,
      exampleCount: _examples.length,
      enabledRules: _rules.filter(r => r.enabled).length,
      enabledAgentRules: _agentRules.filter(r => r.enabled).length,
      enabledPolicies: _policies.filter(p => p.enabled).length,
      actionHandlers: Array.from(_actionHandlers.keys())
    });

    /**
     * Clear all rules, constraints, and examples (keeps builtins).
     * @returns {Promise<void>}
     */
    const clear = async () => {
      _rules = [];
      _constraints = [];
      _inducedRules = [];
      _policies = [];
      _agentRules = [];
      _examples = [];
      addBuiltinRules();
      addBuiltinAgentRules();
      await save();
      logger.info('[RuleEngine] Cleared all rules');
    };

    /**
     * Export all rules and policies for backup/transfer.
     * @returns {Object} Exportable data
     */
    const exportRules = () => ({
      rules: _rules.filter(r => !r.builtin),
      constraints: _constraints,
      policies: _policies.filter(p => !p.builtin),
      agentRules: _agentRules.filter(r => !r.builtin),
      inducedRules: _inducedRules,
      exportedAt: Date.now()
    });

    /**
     * Import rules and policies from exported data.
     * @param {Object} data - Exported data
     * @param {boolean} [merge=true] - Whether to merge with existing or replace
     * @returns {Promise<Object>} Import statistics
     */
    const importRules = async (data, merge = true) => {
      const stats = { rules: 0, constraints: 0, policies: 0, agentRules: 0 };

      if (!merge) {
        _rules = [];
        _constraints = [];
        _policies = [];
        _agentRules = [];
        addBuiltinRules();
        addBuiltinAgentRules();
      }

      if (Array.isArray(data.rules)) {
        for (const rule of data.rules) {
          if (!_rules.find(r => r.id === rule.id)) {
            _rules.push(rule);
            stats.rules++;
          }
        }
      }

      if (Array.isArray(data.constraints)) {
        for (const constraint of data.constraints) {
          if (!_constraints.find(c => c.id === constraint.id)) {
            _constraints.push(constraint);
            stats.constraints++;
          }
        }
      }

      if (Array.isArray(data.policies)) {
        for (const policy of data.policies) {
          if (!_policies.find(p => p.id === policy.id)) {
            _policies.push(policy);
            stats.policies++;
          }
        }
      }

      if (Array.isArray(data.agentRules)) {
        for (const rule of data.agentRules) {
          if (!_agentRules.find(r => r.id === rule.id)) {
            _agentRules.push(rule);
            stats.agentRules++;
          }
        }
        // Re-sort by priority
        _agentRules.sort((a, b) => b.priority - a.priority);
      }

      await save();
      logger.info(`[RuleEngine] Imported ${stats.rules} rules, ${stats.agentRules} agent rules, ${stats.constraints} constraints, ${stats.policies} policies`);
      return stats;
    };

    return {
      // Lifecycle
      init,

      // Rule management (Datalog-style)
      addRule,
      removeRule,
      getRules,
      getRule,
      setRuleEnabled,

      // Constraint management
      addConstraint,
      removeConstraint,
      getConstraints,

      // Inference
      infer,
      queryWithInference,
      validate,

      // Rule induction
      induceRule,
      addExample,
      learnFromExamples,
      getInducedRules,
      getExamples,
      clearExamples,

      // Policy enforcement
      addPolicy,
      removePolicy,
      getPolicies,
      checkPolicy,
      enforcePolicy,

      // Agent Rules (declarative conditions/actions)
      addAgentRule,
      removeAgentRule,
      getAgentRules,
      getAgentRule,
      setAgentRuleEnabled,
      evaluateAgentRules,
      createContext,
      registerActionHandler,

      // VFS persistence
      saveRulesToVFS,
      savePoliciesToVFS,
      exportRules,
      importRules,

      // Utilities
      getStats,
      clear
    };
  }
};

export default RuleEngine;
