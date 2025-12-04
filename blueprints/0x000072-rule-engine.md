# Rule Engine

**Module:** `RuleEngine`
**File:** `./capabilities/cognition/symbolic/rule-engine.js`
**Purpose:** IF-THEN rules for deterministic reasoning

## Overview

Rule engines apply logical rules to facts to derive new knowledge or trigger actions. Example: `IF modified core module THEN run verification`.

## Implementation

```javascript
const RuleEngine = {
  metadata: {
    id: 'RuleEngine',
    dependencies: ['Utils'],
    type: 'capability'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;

    const _rules = [];
    const _facts = new Map();

    const addRule = (name, condition, action) => {
      _rules.push({ name, condition, action });
    };

    const addFact = (key, value) => {
      _facts.set(key, value);
    };

    const evaluate = () => {
      const fired = [];

      for (const rule of _rules) {
        try {
          if (rule.condition(_facts)) {
            logger.info(`Rule fired: ${rule.name}`);
            rule.action(_facts);
            fired.push(rule.name);
          }
        } catch (e) {
          logger.error(`Rule ${rule.name} failed`, e);
        }
      }

      return fired;
    };

    return { addRule, addFact, evaluate };
  }
};
```

## Example Rules

```javascript
ruleEngine.addRule(
  'verify-core-changes',
  (facts) => facts.get('modified_path').startsWith('/core/'),
  (facts) => facts.set('requires_verification', true)
);

ruleEngine.addRule(
  'rate-limit-check',
  (facts) => facts.get('api_calls_per_minute') > 50,
  (facts) => facts.set('should_throttle', true)
);
```
