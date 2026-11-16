/** Pure rule unification and pattern induction; no persistence, tools or policy authority. */
/**
 * Match a rule against facts, returning all valid bindings.
 * @param {Object} rule - The rule to match
 * @param {Object[]} facts - Available facts
 * @returns {Object[]} Array of variable bindings that satisfy the rule body
 * @private
 */
export const matchRule = (rule, facts) => {
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
export const matchAtom = (atom, facts, existingBinding) => {
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

    const newBinding = tryUnify(atom.args, fact.args, existingBinding);
    if (newBinding) {
      if (atom.negated) return [];
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
export const tryUnify = (pattern, values, binding) => {
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
export const isVariable = (term) => typeof term === 'string' && term.startsWith('?');

/**
 * Resolve an argument using current bindings.
 * @param {*} arg - The argument (variable or constant)
 * @param {Object} binding - Variable bindings
 * @returns {*} Resolved value
 * @private
 */
export const resolveArg = (arg, binding) => {
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
export const instantiate = (template, binding) => ({
  predicate: template.predicate,
  args: template.args.map(arg => isVariable(arg) && Object.hasOwn(binding, arg) ? binding[arg] : arg)
});

/**
 * Check if two arrays are equal.
 * @param {Array} a - First array
 * @param {Array} b - Second array
 * @returns {boolean} True if equal
 * @private
 */
export const arraysEqual = (a, b) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/**
 * Find common pattern across examples (simple heuristic approach).
 * @param {Object[]} examples - Positive examples
 * @returns {Object|null} Common pattern or null
 * @private
 */
export const findCommonPattern = (examples) => {
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
