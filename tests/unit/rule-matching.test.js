import { describe, expect, it } from 'vitest';
import { instantiate, matchAtom } from '../../self/capabilities/cognition/symbolic/rule-unification.js';
import { getNestedValue, resolveValue, setNestedValue } from '../../self/capabilities/cognition/symbolic/rule-context.js';

describe('rule matching and context boundaries', () => {
  it('rejects a negated atom only when a unifying fact exists', () => {
    const atom = { predicate: 'blocked', args: ['?subject'], negated: true };
    const facts = [{ predicate: 'blocked', args: ['alice'] }];
    expect(matchAtom(atom, facts, { '?subject': 'alice' })).toEqual([]);
    expect(matchAtom(atom, facts, { '?subject': 'bob' })).toEqual([{ '?subject': 'bob' }]);
    expect(matchAtom({ ...atom, negated: false }, facts, {})).toEqual([{ '?subject': 'alice' }]);
  });

  it('preserves false, zero, empty and null fact bindings', () => {
    for (const value of [false, 0, '', null]) {
      expect(instantiate({ predicate: 'value', args: ['?x', '?unbound'] }, { '?x': value }))
        .toEqual({ predicate: 'value', args: [value, '?unbound'] });
    }
  });

  it('refuses prototype paths and computed keys without mutating context or global objects', () => {
    const context = { row: { value: 1 } };
    for (const path of ['__proto__.polluted', 'row.constructor.prototype.polluted', 'row.__proto__.polluted']) {
      expect(() => setNestedValue(context, path, true)).toThrow('Unsafe rule context path');
      expect(getNestedValue(context, path)).toBeUndefined();
    }
    expect(() => resolveValue({ '${key}': 'unsafe' }, { key: '__proto__' })).toThrow('Unsafe rule context key');
    expect(getNestedValue(Object.create({ inherited: 'secret' }), 'inherited')).toBeUndefined();
    expect(setNestedValue(context, 'row.value', 2)).toEqual({ row: { value: 2 } });
    expect(context).toEqual({ row: { value: 1 } });
    expect(Object.prototype.polluted).toBeUndefined();
  });
});
