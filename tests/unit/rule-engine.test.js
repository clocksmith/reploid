/**
 * @fileoverview Unit tests for RuleEngine module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';
import RuleEngineModule from '../../capabilities/cognition/symbolic/rule-engine.js';

// Mock VFS
const createMockVFS = () => ({
  exists: vi.fn().mockResolvedValue(false),
  read: vi.fn().mockResolvedValue('{}'),
  write: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([])
});

// Mock KnowledgeGraph
const createMockKnowledgeGraph = () => ({
  query: vi.fn().mockReturnValue([]),
  addTriple: vi.fn().mockResolvedValue('triple-1'),
  addEntity: vi.fn().mockResolvedValue('entity-1')
});

// Mock HITLController
const createMockHITLController = (mode = 'autonomous') => ({
  registerModule: vi.fn(),
  requiresApproval: vi.fn().mockReturnValue(mode === 'hitl'),
  requestApproval: vi.fn(({ onApprove, data }) => {
    // Auto-approve in tests
    if (onApprove) setTimeout(() => onApprove(data), 0);
    return 'approval-1';
  })
});

// Mock VerificationManager
const createMockVerificationManager = () => ({
  verifyProposal: vi.fn().mockResolvedValue({ passed: true })
});

describe('RuleEngine', () => {
  let ruleEngine;
  let mockVFS;
  let mockKnowledgeGraph;
  let mockEventBus;
  let utils;

  beforeEach(async () => {
    utils = UtilsModule.factory();
    mockEventBus = EventBusModule.factory({ Utils: utils });
    mockVFS = createMockVFS();
    mockKnowledgeGraph = createMockKnowledgeGraph();

    ruleEngine = RuleEngineModule.factory({
      Utils: utils,
      VFS: mockVFS,
      EventBus: mockEventBus,
      KnowledgeGraph: mockKnowledgeGraph
    });

    await ruleEngine.init();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('should initialize with builtin rules', async () => {
      const rules = ruleEngine.getRules();
      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some(r => r.id === 'builtin-isa-transitive')).toBe(true);
    });

    it('should load rules from VFS if store exists', async () => {
      const loadMockVFS = {
        ...mockVFS,
        exists: vi.fn().mockImplementation((path) => {
          if (path === '/.memory/rules.json') return Promise.resolve(true);
          return Promise.resolve(false);
        }),
        read: vi.fn().mockResolvedValue(JSON.stringify({
          rules: [{ id: 'test-rule', head: { predicate: 'test', args: ['?x'] }, body: [], enabled: true }],
          constraints: [],
          inducedRules: [],
          policies: [],
          examples: []
        })),
        list: vi.fn().mockResolvedValue([])
      };

      const newEngine = RuleEngineModule.factory({
        Utils: utils,
        VFS: loadMockVFS,
        EventBus: mockEventBus,
        KnowledgeGraph: mockKnowledgeGraph
      });

      await newEngine.init();

      const rules = newEngine.getRules();
      expect(rules.some(r => r.id === 'test-rule')).toBe(true);
    });

    it('should register with HITL if available', async () => {
      const mockHITL = createMockHITLController();

      const newEngine = RuleEngineModule.factory({
        Utils: utils,
        VFS: mockVFS,
        EventBus: mockEventBus,
        KnowledgeGraph: mockKnowledgeGraph,
        HITLController: mockHITL
      });

      await newEngine.init();

      expect(mockHITL.registerModule).toHaveBeenCalledWith(
        'RuleEngine',
        expect.any(Array),
        expect.any(String)
      );
    });
  });

  describe('addRule', () => {
    it('should add a new rule', async () => {
      const id = await ruleEngine.addRule({
        head: { predicate: 'likes', args: ['?x', '?y'] },
        body: [{ predicate: 'friend', args: ['?x', '?y'] }]
      });

      expect(id).toBeDefined();
      const rule = ruleEngine.getRule(id);
      expect(rule).not.toBeNull();
      expect(rule.head.predicate).toBe('likes');
    });

    it('should update existing rule with same ID', async () => {
      const id = await ruleEngine.addRule({
        id: 'my-rule',
        head: { predicate: 'test', args: ['?x'] },
        body: [],
        priority: 10
      });

      await ruleEngine.addRule({
        id: 'my-rule',
        head: { predicate: 'test', args: ['?x'] },
        body: [],
        priority: 20
      });

      const rule = ruleEngine.getRule('my-rule');
      expect(rule.priority).toBe(20);
    });

    it('should emit event when rule is added', async () => {
      const listener = vi.fn();
      mockEventBus.on('cognition:symbolic:add', listener);

      await ruleEngine.addRule({
        head: { predicate: 'test', args: ['?x'] },
        body: []
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'rule' })
      );
    });
  });

  describe('removeRule', () => {
    it('should remove a user rule', async () => {
      const id = await ruleEngine.addRule({
        head: { predicate: 'test', args: ['?x'] },
        body: []
      });

      const result = await ruleEngine.removeRule(id);
      expect(result).toBe(true);
      expect(ruleEngine.getRule(id)).toBeNull();
    });

    it('should not remove builtin rules', async () => {
      const result = await ruleEngine.removeRule('builtin-isa-transitive');
      expect(result).toBe(false);
      expect(ruleEngine.getRule('builtin-isa-transitive')).not.toBeNull();
    });

    it('should return false for non-existent rule', async () => {
      const result = await ruleEngine.removeRule('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('setRuleEnabled', () => {
    it('should enable/disable a rule', async () => {
      const id = await ruleEngine.addRule({
        head: { predicate: 'test', args: ['?x'] },
        body: []
      });

      await ruleEngine.setRuleEnabled(id, false);
      let rule = ruleEngine.getRule(id);
      expect(rule.enabled).toBe(false);

      await ruleEngine.setRuleEnabled(id, true);
      rule = ruleEngine.getRule(id);
      expect(rule.enabled).toBe(true);
    });
  });

  describe('addConstraint', () => {
    it('should add a constraint', async () => {
      const id = await ruleEngine.addConstraint({
        body: [{ predicate: 'invalid', args: ['?x'] }],
        message: 'Invalid state detected',
        severity: 'error'
      });

      expect(id).toBeDefined();
      const constraints = ruleEngine.getConstraints();
      expect(constraints.some(c => c.id === id)).toBe(true);
    });
  });

  describe('removeConstraint', () => {
    it('should remove a constraint', async () => {
      const id = await ruleEngine.addConstraint({
        body: [{ predicate: 'test', args: ['?x'] }],
        message: 'Test'
      });

      const result = await ruleEngine.removeConstraint(id);
      expect(result).toBe(true);
      expect(ruleEngine.getConstraints().some(c => c.id === id)).toBe(false);
    });
  });

  describe('infer', () => {
    it('should derive facts using rules', async () => {
      // Setup: Add facts to KnowledgeGraph mock
      mockKnowledgeGraph.query.mockReturnValue([
        { subject: 'A', predicate: 'isA', object: 'B', metadata: { confidence: 1.0 } },
        { subject: 'B', predicate: 'subClassOf', object: 'C', metadata: { confidence: 1.0 } }
      ]);

      const facts = await ruleEngine.infer();

      // Should have at least the original 2 facts
      expect(facts.length).toBeGreaterThanOrEqual(2);
    });

    it('should not exceed max iterations', async () => {
      mockKnowledgeGraph.query.mockReturnValue([]);

      const facts = await ruleEngine.infer(5);

      // Should complete without infinite loop
      expect(Array.isArray(facts)).toBe(true);
    });
  });

  describe('queryWithInference', () => {
    it('should filter facts by pattern', async () => {
      mockKnowledgeGraph.query.mockReturnValue([
        { subject: 'A', predicate: 'likes', object: 'B', metadata: { confidence: 1.0 } },
        { subject: 'C', predicate: 'hates', object: 'D', metadata: { confidence: 1.0 } }
      ]);

      const facts = await ruleEngine.queryWithInference({ predicate: 'likes' });

      expect(facts.every(f => f.predicate === 'likes')).toBe(true);
    });
  });

  describe('validate', () => {
    it('should detect constraint violations', async () => {
      await ruleEngine.addConstraint({
        body: [{ predicate: 'error', args: ['?x', '?y'] }],
        message: 'Error detected',
        severity: 'error'
      });

      mockKnowledgeGraph.query.mockReturnValue([
        { subject: 'system', predicate: 'error', object: 'crash', metadata: { confidence: 1.0 } }
      ]);

      const result = await ruleEngine.validate();

      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should return valid when no violations', async () => {
      mockKnowledgeGraph.query.mockReturnValue([
        { subject: 'A', predicate: 'ok', object: 'B', metadata: { confidence: 1.0 } }
      ]);

      const result = await ruleEngine.validate();

      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
    });
  });

  describe('Rule Induction', () => {
    describe('induceRule', () => {
      it('should induce a rule from pattern', async () => {
        const id = await ruleEngine.induceRule({
          head: { predicate: 'learned', args: ['?x'] },
          body: [{ predicate: 'observed', args: ['?x'] }],
          confidence: 0.8,
          support: 5
        });

        expect(id).toBeDefined();
        const induced = ruleEngine.getInducedRules();
        expect(induced.some(r => r.id === id)).toBe(true);
      });

      it('should set lower priority for induced rules', async () => {
        const id = await ruleEngine.induceRule({
          head: { predicate: 'learned', args: ['?x'] },
          body: []
        });

        const rule = ruleEngine.getRule(id);
        expect(rule.priority).toBe(30);
        expect(rule.source).toBe('induced');
      });
    });

    describe('addExample', () => {
      it('should add training example', async () => {
        await ruleEngine.addExample({
          input: [{ predicate: 'input', args: ['a', 'b'] }],
          output: { predicate: 'output', args: ['a'] },
          positive: true
        });

        const examples = ruleEngine.getExamples();
        expect(examples.length).toBe(1);
      });
    });

    describe('learnFromExamples', () => {
      it('should induce rules from sufficient examples', async () => {
        const examples = [
          { input: [{ predicate: 'hasFeature', args: ['x1', 'f1'] }], output: { predicate: 'isType', args: ['x1'] } },
          { input: [{ predicate: 'hasFeature', args: ['x2', 'f2'] }], output: { predicate: 'isType', args: ['x2'] } },
          { input: [{ predicate: 'hasFeature', args: ['x3', 'f3'] }], output: { predicate: 'isType', args: ['x3'] } }
        ];

        const ids = await ruleEngine.learnFromExamples(examples, { minSupport: 3 });

        expect(ids.length).toBeGreaterThan(0);
      });

      it('should not induce rules with insufficient examples', async () => {
        const examples = [
          { input: [{ predicate: 'rare', args: ['x1'] }], output: { predicate: 'result', args: ['x1'] } }
        ];

        const ids = await ruleEngine.learnFromExamples(examples, { minSupport: 3 });

        expect(ids.length).toBe(0);
      });
    });

    describe('clearExamples', () => {
      it('should clear all examples', async () => {
        await ruleEngine.addExample({
          input: [{ predicate: 'test', args: ['a'] }],
          output: { predicate: 'out', args: ['a'] }
        });

        await ruleEngine.clearExamples();

        expect(ruleEngine.getExamples().length).toBe(0);
      });
    });
  });

  describe('Policy Enforcement', () => {
    describe('addPolicy', () => {
      it('should add a policy', async () => {
        const id = await ruleEngine.addPolicy({
          name: 'Test Policy',
          trigger: { predicate: 'action', args: ['delete', '?target'] },
          action: 'require_approval',
          level: 'L2'
        });

        expect(id).toBeDefined();
        const policies = ruleEngine.getPolicies();
        expect(policies.some(p => p.id === id)).toBe(true);
      });
    });

    describe('removePolicy', () => {
      it('should remove a user policy', async () => {
        const id = await ruleEngine.addPolicy({
          name: 'Removable',
          trigger: { predicate: 'test', args: ['?x'] },
          action: 'log'
        });

        const result = await ruleEngine.removePolicy(id);
        expect(result).toBe(true);
      });

      it('should not remove builtin policies', async () => {
        const result = await ruleEngine.removePolicy('builtin-substrate-approval');
        expect(result).toBe(false);
      });
    });

    describe('checkPolicy', () => {
      it('should allow actions not matching any policy', async () => {
        const result = await ruleEngine.checkPolicy({
          type: 'read',
          target: '/data/file.json'
        });

        expect(result.allowed).toBe(true);
        expect(result.requiresApproval).toBe(false);
      });

      it('should detect policy violations', async () => {
        await ruleEngine.addPolicy({
          name: 'Deny Delete',
          trigger: { predicate: 'action', args: ['delete', '?target'] },
          action: 'deny'
        });

        const result = await ruleEngine.checkPolicy({
          type: 'delete',
          target: '/important/file.js'
        });

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(false);
      });

      it('should require approval for matching policies', async () => {
        await ruleEngine.addPolicy({
          name: 'Approve Writes',
          trigger: { predicate: 'action', args: ['write', '?target'] },
          action: 'require_approval',
          level: 'L2'
        });

        const result = await ruleEngine.checkPolicy({
          type: 'write',
          target: '/data/file.json'
        });

        expect(result.allowed).toBe(false);
        expect(result.requiresApproval).toBe(true);
      });

      it('should detect substrate modifications', async () => {
        // Add explicit policy for substrate modifications
        await ruleEngine.addPolicy({
          name: 'Core Write Approval',
          trigger: { predicate: 'modifies', args: ['?action', 'substrate'] },
          action: 'require_approval',
          level: 'L3'
        });

        const result = await ruleEngine.checkPolicy({
          type: 'write',
          target: '/core/agent-loop.js'
        });

        expect(result.requiresApproval).toBe(true);
      });
    });

    describe('enforcePolicy', () => {
      it('should call onApproved for allowed actions', async () => {
        const onApproved = vi.fn();
        const onDenied = vi.fn();

        await ruleEngine.enforcePolicy(
          { type: 'read', target: '/safe/file.txt' },
          onApproved,
          onDenied
        );

        expect(onApproved).toHaveBeenCalled();
        expect(onDenied).not.toHaveBeenCalled();
      });

      it('should call onDenied for denied actions', async () => {
        await ruleEngine.addPolicy({
          name: 'Block All',
          trigger: { predicate: 'action', args: ['blocked', '?target'] },
          action: 'deny'
        });

        const onApproved = vi.fn();
        const onDenied = vi.fn();

        await ruleEngine.enforcePolicy(
          { type: 'blocked', target: '/file.txt' },
          onApproved,
          onDenied
        );

        expect(onApproved).not.toHaveBeenCalled();
        expect(onDenied).toHaveBeenCalled();
      });
    });
  });

  describe('VFS Persistence', () => {
    describe('saveRulesToVFS', () => {
      it('should save rules to VFS file', async () => {
        const rules = [
          { id: 'rule-1', head: { predicate: 'test', args: ['?x'] }, body: [] }
        ];

        const path = await ruleEngine.saveRulesToVFS('custom-rules.json', rules);

        expect(path).toBe('/rules/custom-rules.json');
        expect(mockVFS.write).toHaveBeenCalled();
      });
    });

    describe('savePoliciesToVFS', () => {
      it('should save policies to VFS file', async () => {
        const policies = [
          { id: 'policy-1', name: 'Test', trigger: { predicate: 'test', args: ['?x'] }, action: 'log' }
        ];

        const path = await ruleEngine.savePoliciesToVFS('custom-policies.json', policies);

        expect(path).toBe('/rules/policies/custom-policies.json');
        expect(mockVFS.write).toHaveBeenCalled();
      });
    });

    describe('exportRules/importRules', () => {
      it('should export and import rules', async () => {
        await ruleEngine.addRule({
          id: 'export-test',
          head: { predicate: 'exported', args: ['?x'] },
          body: []
        });

        const exported = ruleEngine.exportRules();

        expect(exported.rules.some(r => r.id === 'export-test')).toBe(true);
        expect(exported.exportedAt).toBeDefined();

        // Clear and reimport
        await ruleEngine.clear();
        const stats = await ruleEngine.importRules(exported);

        expect(stats.rules).toBeGreaterThan(0);
      });

      it('should merge on import by default', async () => {
        await ruleEngine.addRule({
          id: 'existing',
          head: { predicate: 'existing', args: ['?x'] },
          body: []
        });

        await ruleEngine.importRules({
          rules: [{ id: 'imported', head: { predicate: 'imported', args: ['?x'] }, body: [] }]
        });

        // Both should exist
        expect(ruleEngine.getRule('existing')).not.toBeNull();
        expect(ruleEngine.getRule('imported')).not.toBeNull();
      });

      it('should replace on import when merge=false', async () => {
        await ruleEngine.addRule({
          id: 'to-replace',
          head: { predicate: 'old', args: ['?x'] },
          body: []
        });

        await ruleEngine.importRules({
          rules: [{ id: 'new-rule', head: { predicate: 'new', args: ['?x'] }, body: [] }]
        }, false);

        // Old rule should be gone, new should exist
        expect(ruleEngine.getRule('to-replace')).toBeNull();
        expect(ruleEngine.getRule('new-rule')).not.toBeNull();
      });
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      await ruleEngine.addRule({
        head: { predicate: 'test', args: ['?x'] },
        body: []
      });

      await ruleEngine.addConstraint({
        body: [{ predicate: 'error', args: ['?x'] }],
        message: 'Error'
      });

      await ruleEngine.addPolicy({
        name: 'Test',
        trigger: { predicate: 'test', args: ['?x'] },
        action: 'log'
      });

      const stats = ruleEngine.getStats();

      expect(stats.ruleCount).toBeGreaterThan(1); // At least builtins + 1
      expect(stats.constraintCount).toBe(1);
      expect(stats.policyCount).toBeGreaterThan(0);
      expect(stats.enabledRules).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('should clear all rules and keep builtins', async () => {
      await ruleEngine.addRule({
        id: 'user-rule',
        head: { predicate: 'user', args: ['?x'] },
        body: []
      });

      await ruleEngine.clear();

      // User rule should be gone
      expect(ruleEngine.getRule('user-rule')).toBeNull();

      // Builtin should still exist
      expect(ruleEngine.getRule('builtin-isa-transitive')).not.toBeNull();
    });
  });

  describe('HITL Integration', () => {
    it('should request approval for induced rules in HITL mode', async () => {
      const mockHITL = createMockHITLController('hitl');

      const newEngine = RuleEngineModule.factory({
        Utils: utils,
        VFS: mockVFS,
        EventBus: mockEventBus,
        KnowledgeGraph: mockKnowledgeGraph,
        HITLController: mockHITL
      });

      await newEngine.init();

      await newEngine.induceRule({
        head: { predicate: 'test', args: ['?x'] },
        body: []
      });

      expect(mockHITL.requestApproval).toHaveBeenCalled();
    });
  });

  // --- Agent Rules Tests ---

  describe('Agent Rules', () => {
    describe('addAgentRule', () => {
      it('should add a new agent rule', async () => {
        const id = await ruleEngine.addAgentRule({
          name: 'Test Rule',
          conditions: [
            { path: 'cycle', op: 'gt', value: 5 }
          ],
          actions: [
            { type: 'log', params: { message: 'Cycle exceeded 5' } }
          ]
        });

        expect(id).toBeDefined();
        const rule = ruleEngine.getAgentRule(id);
        expect(rule).not.toBeNull();
        expect(rule.name).toBe('Test Rule');
      });

      it('should sort rules by priority (descending)', async () => {
        await ruleEngine.addAgentRule({
          id: 'low-priority',
          name: 'Low Priority',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'low' } }],
          priority: 10
        });

        await ruleEngine.addAgentRule({
          id: 'high-priority',
          name: 'High Priority',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'high' } }],
          priority: 100
        });

        const rules = ruleEngine.getAgentRules();
        const highIdx = rules.findIndex(r => r.id === 'high-priority');
        const lowIdx = rules.findIndex(r => r.id === 'low-priority');
        expect(highIdx).toBeLessThan(lowIdx);
      });

      it('should update existing rule with same ID', async () => {
        await ruleEngine.addAgentRule({
          id: 'my-rule',
          name: 'Original',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'orig' } }],
          priority: 10
        });

        await ruleEngine.addAgentRule({
          id: 'my-rule',
          name: 'Updated',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'updated' } }],
          priority: 20
        });

        const rule = ruleEngine.getAgentRule('my-rule');
        expect(rule.name).toBe('Updated');
        expect(rule.priority).toBe(20);
      });
    });

    describe('removeAgentRule', () => {
      it('should remove a user agent rule', async () => {
        const id = await ruleEngine.addAgentRule({
          name: 'Removable',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'test' } }]
        });

        const result = await ruleEngine.removeAgentRule(id);
        expect(result).toBe(true);
        expect(ruleEngine.getAgentRule(id)).toBeNull();
      });

      it('should not remove builtin agent rules', async () => {
        const result = await ruleEngine.removeAgentRule('builtin-high-cycle-warning');
        expect(result).toBe(false);
        expect(ruleEngine.getAgentRule('builtin-high-cycle-warning')).not.toBeNull();
      });
    });

    describe('getAgentRules', () => {
      it('should filter by tags', async () => {
        await ruleEngine.addAgentRule({
          id: 'tagged-rule',
          name: 'Tagged',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'tagged' } }],
          tags: ['special', 'test']
        });

        await ruleEngine.addAgentRule({
          id: 'untagged-rule',
          name: 'Untagged',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'untagged' } }],
          tags: []
        });

        const specialRules = ruleEngine.getAgentRules(['special']);
        expect(specialRules.some(r => r.id === 'tagged-rule')).toBe(true);
        expect(specialRules.some(r => r.id === 'untagged-rule')).toBe(false);
      });

      it('should only return enabled rules', async () => {
        await ruleEngine.addAgentRule({
          id: 'disabled-rule',
          name: 'Disabled',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'disabled' } }],
          enabled: false
        });

        const rules = ruleEngine.getAgentRules();
        expect(rules.some(r => r.id === 'disabled-rule')).toBe(false);
      });
    });

    describe('setAgentRuleEnabled', () => {
      it('should enable/disable an agent rule', async () => {
        const id = await ruleEngine.addAgentRule({
          name: 'Toggle',
          conditions: [],
          actions: [{ type: 'log', params: { message: 'toggle' } }]
        });

        await ruleEngine.setAgentRuleEnabled(id, false);
        let rule = ruleEngine.getAgentRule(id);
        expect(rule.enabled).toBe(false);

        await ruleEngine.setAgentRuleEnabled(id, true);
        rule = ruleEngine.getAgentRule(id);
        expect(rule.enabled).toBe(true);
      });
    });
  });

  describe('Condition Matching', () => {
    it('should match equality conditions', async () => {
      const id = await ruleEngine.addAgentRule({
        name: 'Eq Test',
        conditions: [
          { path: 'status', op: 'eq', value: 'active' }
        ],
        actions: [{ type: 'log', params: { message: 'matched' } }]
      });

      const result = await ruleEngine.evaluateAgentRules({ status: 'active' }, { dryRun: true });
      expect(result.matched).toBeGreaterThan(0);
      expect(result.fired.some(r => r.id === id)).toBe(true);
    });

    it('should match comparison operators', async () => {
      await ruleEngine.addAgentRule({
        id: 'gt-rule',
        name: 'GT Test',
        conditions: [{ path: 'count', op: 'gt', value: 10 }],
        actions: [{ type: 'log', params: { message: 'gt' } }]
      });

      await ruleEngine.addAgentRule({
        id: 'gte-rule',
        name: 'GTE Test',
        conditions: [{ path: 'count', op: 'gte', value: 10 }],
        actions: [{ type: 'log', params: { message: 'gte' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ count: 15 }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'gt-rule')).toBe(true);
      expect(result1.fired.some(r => r.id === 'gte-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ count: 10 }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'gt-rule')).toBe(false);
      expect(result2.fired.some(r => r.id === 'gte-rule')).toBe(true);
    });

    it('should match nested path values', async () => {
      await ruleEngine.addAgentRule({
        id: 'nested-rule',
        name: 'Nested Test',
        conditions: [
          { path: 'state.agent.status', op: 'eq', value: 'running' }
        ],
        actions: [{ type: 'log', params: { message: 'nested matched' } }]
      });

      const result = await ruleEngine.evaluateAgentRules({
        state: { agent: { status: 'running' } }
      }, { dryRun: true });

      expect(result.fired.some(r => r.id === 'nested-rule')).toBe(true);
    });

    it('should match logical AND conditions', async () => {
      await ruleEngine.addAgentRule({
        id: 'and-rule',
        name: 'AND Test',
        conditions: [
          {
            and: [
              { path: 'a', op: 'eq', value: 1 },
              { path: 'b', op: 'eq', value: 2 }
            ]
          }
        ],
        actions: [{ type: 'log', params: { message: 'and matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ a: 1, b: 2 }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'and-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ a: 1, b: 3 }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'and-rule')).toBe(false);
    });

    it('should match logical OR conditions', async () => {
      await ruleEngine.addAgentRule({
        id: 'or-rule',
        name: 'OR Test',
        conditions: [
          {
            or: [
              { path: 'status', op: 'eq', value: 'active' },
              { path: 'status', op: 'eq', value: 'pending' }
            ]
          }
        ],
        actions: [{ type: 'log', params: { message: 'or matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ status: 'active' }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'or-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ status: 'inactive' }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'or-rule')).toBe(false);
    });

    it('should match NOT conditions', async () => {
      await ruleEngine.addAgentRule({
        id: 'not-rule',
        name: 'NOT Test',
        conditions: [
          { not: { path: 'status', op: 'eq', value: 'disabled' } }
        ],
        actions: [{ type: 'log', params: { message: 'not matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ status: 'enabled' }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'not-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ status: 'disabled' }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'not-rule')).toBe(false);
    });

    it('should match contains operator', async () => {
      await ruleEngine.addAgentRule({
        id: 'contains-rule',
        name: 'Contains Test',
        conditions: [
          { path: 'message', op: 'contains', value: 'error' }
        ],
        actions: [{ type: 'log', params: { message: 'contains matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ message: 'An error occurred' }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'contains-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ message: 'All good' }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'contains-rule')).toBe(false);
    });

    it('should match regex operator', async () => {
      await ruleEngine.addAgentRule({
        id: 'regex-rule',
        name: 'Regex Test',
        conditions: [
          { path: 'email', op: 'matches', value: '^[a-z]+@example\\.com$' }
        ],
        actions: [{ type: 'log', params: { message: 'regex matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ email: 'test@example.com' }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'regex-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ email: 'test@other.com' }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'regex-rule')).toBe(false);
    });

    it('should match exists operator', async () => {
      await ruleEngine.addAgentRule({
        id: 'exists-rule',
        name: 'Exists Test',
        conditions: [
          { path: 'optional', op: 'exists', value: true }
        ],
        actions: [{ type: 'log', params: { message: 'exists matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ optional: 'value' }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'exists-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ other: 'value' }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'exists-rule')).toBe(false);
    });

    it('should match in operator', async () => {
      await ruleEngine.addAgentRule({
        id: 'in-rule',
        name: 'In Test',
        conditions: [
          { path: 'status', op: 'in', value: ['active', 'pending', 'review'] }
        ],
        actions: [{ type: 'log', params: { message: 'in matched' } }]
      });

      const result1 = await ruleEngine.evaluateAgentRules({ status: 'pending' }, { dryRun: true });
      expect(result1.fired.some(r => r.id === 'in-rule')).toBe(true);

      const result2 = await ruleEngine.evaluateAgentRules({ status: 'closed' }, { dryRun: true });
      expect(result2.fired.some(r => r.id === 'in-rule')).toBe(false);
    });
  });

  describe('Action Execution', () => {
    it('should execute log action', async () => {
      await ruleEngine.addAgentRule({
        id: 'log-action-rule',
        name: 'Log Action',
        conditions: [{ path: 'trigger', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'Action executed!' } }]
      });

      const listener = vi.fn();
      mockEventBus.on('rule:action:log', listener);

      await ruleEngine.evaluateAgentRules({ trigger: true });

      expect(listener).toHaveBeenCalled();
    });

    it('should execute emit action', async () => {
      await ruleEngine.addAgentRule({
        id: 'emit-action-rule',
        name: 'Emit Action',
        conditions: [{ path: 'trigger', op: 'eq', value: true }],
        actions: [{
          type: 'emit',
          params: { event: 'custom:event', data: { key: 'value' } }
        }]
      });

      const listener = vi.fn();
      mockEventBus.on('custom:event', listener);

      await ruleEngine.evaluateAgentRules({ trigger: true });

      expect(listener).toHaveBeenCalledWith({ key: 'value' });
    });

    it('should execute addFact action', async () => {
      await ruleEngine.addAgentRule({
        id: 'fact-action-rule',
        name: 'Fact Action',
        conditions: [{ path: 'trigger', op: 'eq', value: true }],
        actions: [{
          type: 'addFact',
          params: {
            subject: 'entity1',
            predicate: 'hasStatus',
            object: 'active'
          }
        }]
      });

      await ruleEngine.evaluateAgentRules({ trigger: true });

      expect(mockKnowledgeGraph.addTriple).toHaveBeenCalledWith(
        'entity1', 'hasStatus', 'active', expect.any(Object)
      );
    });

    it('should support template interpolation in actions', async () => {
      await ruleEngine.addAgentRule({
        id: 'template-rule',
        name: 'Template Action',
        conditions: [{ path: 'name', op: 'exists', value: true }],
        actions: [{
          type: 'log',
          params: { message: 'Hello, ${name}! Cycle: ${cycle}' }
        }]
      });

      const listener = vi.fn();
      mockEventBus.on('rule:action:log', listener);

      await ruleEngine.evaluateAgentRules({ name: 'Agent', cycle: 5 });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Hello, Agent! Cycle: 5' })
      );
    });

    it('should execute sequence of actions', async () => {
      const logs = [];
      const originalLog = ruleEngine.registerActionHandler;

      await ruleEngine.addAgentRule({
        id: 'sequence-rule',
        name: 'Sequence Action',
        conditions: [{ path: 'trigger', op: 'eq', value: true }],
        actions: [
          { type: 'log', params: { message: 'First' } },
          { type: 'log', params: { message: 'Second' } },
          { type: 'log', params: { message: 'Third' } }
        ]
      });

      const listener = vi.fn();
      mockEventBus.on('rule:action:log', listener);

      await ruleEngine.evaluateAgentRules({ trigger: true });

      expect(listener).toHaveBeenCalledTimes(3);
    });
  });

  describe('evaluateAgentRules', () => {
    it('should return evaluation results', async () => {
      await ruleEngine.addAgentRule({
        id: 'eval-rule',
        name: 'Eval Test',
        conditions: [{ path: 'active', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'evaluated' } }]
      });

      const result = await ruleEngine.evaluateAgentRules({ active: true }, { dryRun: true });

      expect(result.evaluated).toBeGreaterThan(0);
      expect(result.matched).toBeGreaterThan(0);
      expect(result.fired.length).toBeGreaterThan(0);
      expect(result.dryRun).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should respect stopOnFirst option', async () => {
      await ruleEngine.addAgentRule({
        id: 'first-rule',
        name: 'First',
        conditions: [{ path: 'active', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'first' } }],
        priority: 100
      });

      await ruleEngine.addAgentRule({
        id: 'second-rule',
        name: 'Second',
        conditions: [{ path: 'active', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'second' } }],
        priority: 50
      });

      const result = await ruleEngine.evaluateAgentRules(
        { active: true },
        { dryRun: true, stopOnFirst: true }
      );

      expect(result.matched).toBe(1);
      expect(result.fired[0].id).toBe('first-rule');
    });

    it('should respect maxRules option', async () => {
      for (let i = 0; i < 5; i++) {
        await ruleEngine.addAgentRule({
          id: `rule-${i}`,
          name: `Rule ${i}`,
          conditions: [{ path: 'active', op: 'eq', value: true }],
          actions: [{ type: 'log', params: { message: `rule ${i}` } }],
          priority: 50 - i
        });
      }

      const result = await ruleEngine.evaluateAgentRules(
        { active: true },
        { dryRun: true, maxRules: 2 }
      );

      expect(result.matched).toBe(2);
    });

    it('should respect once flag', async () => {
      await ruleEngine.addAgentRule({
        id: 'once-rule',
        name: 'Once Only',
        conditions: [{ path: 'active', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'once' } }],
        once: true
      });

      // First evaluation
      const result1 = await ruleEngine.evaluateAgentRules({ active: true });
      expect(result1.fired.some(r => r.id === 'once-rule')).toBe(true);

      // Second evaluation - should skip
      const result2 = await ruleEngine.evaluateAgentRules({ active: true });
      expect(result2.skipped.some(s => s.id === 'once-rule' && s.reason === 'once')).toBe(true);
    });

    it('should emit events on rule evaluation', async () => {
      await ruleEngine.addAgentRule({
        id: 'event-rule',
        name: 'Event Test',
        conditions: [{ path: 'active', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'event' } }]
      });

      const firedListener = vi.fn();
      const evalListener = vi.fn();
      mockEventBus.on('rule:agent:fired', firedListener);
      mockEventBus.on('rule:agent:evaluated', evalListener);

      await ruleEngine.evaluateAgentRules({ active: true });

      expect(firedListener).toHaveBeenCalled();
      expect(evalListener).toHaveBeenCalled();
    });
  });

  describe('createContext', () => {
    it('should create context with provided sources', () => {
      const context = ruleEngine.createContext({
        message: { content: 'Hello' },
        tool: { name: 'ReadFile', args: {} },
        cycle: 5,
        custom: { extra: 'data' }
      });

      expect(context.message.content).toBe('Hello');
      expect(context.tool.name).toBe('ReadFile');
      expect(context.cycle).toBe(5);
      expect(context.extra).toBe('data');
      expect(context.timestamp).toBeDefined();
    });
  });

  describe('registerActionHandler', () => {
    it('should register a custom action handler', async () => {
      const customHandler = vi.fn().mockResolvedValue({ success: true, custom: true });

      ruleEngine.registerActionHandler('customAction', customHandler);

      await ruleEngine.addAgentRule({
        id: 'custom-action-rule',
        name: 'Custom Action',
        conditions: [{ path: 'trigger', op: 'eq', value: true }],
        actions: [{ type: 'customAction', params: { key: 'value' } }]
      });

      await ruleEngine.evaluateAgentRules({ trigger: true });

      expect(customHandler).toHaveBeenCalled();
    });

    it('should throw error for non-function handler', () => {
      expect(() => ruleEngine.registerActionHandler('bad', 'not a function'))
        .toThrow('Action handler must be a function');
    });
  });

  describe('Builtin Agent Rules', () => {
    it('should include builtin agent rules', () => {
      const rules = ruleEngine.getAgentRules();
      expect(rules.some(r => r.id === 'builtin-high-cycle-warning')).toBe(true);
      expect(rules.some(r => r.id === 'builtin-tool-error-tracking')).toBe(true);
    });
  });

  describe('Stats with Agent Rules', () => {
    it('should include agent rule stats', async () => {
      await ruleEngine.addAgentRule({
        name: 'Stats Test',
        conditions: [],
        actions: [{ type: 'log', params: { message: 'stats' } }]
      });

      const stats = ruleEngine.getStats();

      expect(stats.agentRuleCount).toBeGreaterThan(0);
      expect(stats.enabledAgentRules).toBeGreaterThan(0);
      expect(stats.actionHandlers).toContain('log');
      expect(stats.actionHandlers).toContain('emit');
      expect(stats.actionHandlers).toContain('executeTool');
      expect(stats.actionHandlers).toContain('addFact');
    });
  });

  describe('Export/Import with Agent Rules', () => {
    it('should export and import agent rules', async () => {
      await ruleEngine.addAgentRule({
        id: 'export-agent-rule',
        name: 'Export Test',
        conditions: [{ path: 'test', op: 'eq', value: true }],
        actions: [{ type: 'log', params: { message: 'exported' } }]
      });

      const exported = ruleEngine.exportRules();
      expect(exported.agentRules.some(r => r.id === 'export-agent-rule')).toBe(true);

      await ruleEngine.clear();
      expect(ruleEngine.getAgentRule('export-agent-rule')).toBeNull();

      const stats = await ruleEngine.importRules(exported);
      expect(stats.agentRules).toBeGreaterThan(0);
      expect(ruleEngine.getAgentRule('export-agent-rule')).not.toBeNull();
    });
  });
});
