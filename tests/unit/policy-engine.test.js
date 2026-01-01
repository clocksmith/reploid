/**
 * @fileoverview Unit tests for PolicyEngine module
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import UtilsModule from '../../core/utils.js';
import EventBusModule from '../../infrastructure/event-bus.js';
import PolicyEngineModule from '../../infrastructure/policy-engine.js';

// Mock VFS
const createMockVFS = () => ({
  exists: vi.fn().mockResolvedValue(false),
  read: vi.fn().mockResolvedValue('{}'),
  write: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([])
});

// Mock AuditLogger
const createMockAuditLogger = () => ({
  logEvent: vi.fn().mockResolvedValue(undefined)
});

describe('PolicyEngine', () => {
  let policyEngine;
  let mockVFS;
  let mockEventBus;
  let mockAuditLogger;
  let utils;

  beforeEach(async () => {
    utils = UtilsModule.factory();
    mockEventBus = EventBusModule.factory({ Utils: utils });
    mockVFS = createMockVFS();
    mockAuditLogger = createMockAuditLogger();

    policyEngine = PolicyEngineModule.factory({
      Utils: utils,
      VFS: mockVFS,
      EventBus: mockEventBus,
      AuditLogger: mockAuditLogger
    });

    await policyEngine.init();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('init', () => {
    it('should initialize successfully', async () => {
      const stats = policyEngine.getStats();
      expect(stats.initialized).toBe(true);
    });

    it('should emit policy:loaded event', async () => {
      const listener = vi.fn();
      mockEventBus.on('policy:loaded', listener);

      const newEngine = PolicyEngineModule.factory({
        Utils: utils,
        VFS: mockVFS,
        EventBus: mockEventBus
      });
      await newEngine.init();

      expect(listener).toHaveBeenCalled();
    });

    it('should default to block enforcement mode', () => {
      expect(policyEngine.getEnforcementMode()).toBe('block');
    });
  });

  describe('DSL Parsing', () => {
    describe('parsePolicyDSL', () => {
      it('should parse simple deny rule', () => {
        const dsl = 'deny { tool.name == "DeleteFile" }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.type).toBe('deny');
        expect(policy.condition).toBeDefined();
        expect(policy.condition.type).toBe('comparison');
        expect(policy.condition.op).toBe('eq');
      });

      it('should parse simple allow rule', () => {
        const dsl = 'allow { tool.name == "ReadFile" }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.type).toBe('allow');
      });

      it('should parse AND conditions', () => {
        const dsl = 'deny { tool.name == "fetch" && tool.args.url == "http://evil.com" }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.type).toBe('and');
        expect(policy.condition.left.type).toBe('comparison');
        expect(policy.condition.right.type).toBe('comparison');
      });

      it('should parse OR conditions', () => {
        const dsl = 'deny { tool.name == "Delete" || tool.name == "Remove" }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.type).toBe('or');
      });

      it('should parse NOT conditions', () => {
        const dsl = 'deny { !tool.args.safe }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.type).toBe('not');
      });

      it('should parse startsWith method', () => {
        const dsl = 'deny { tool.args.path.startsWith("/etc/") }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.type).toBe('comparison');
        expect(policy.condition.op).toBe('startsWith');
      });

      it('should parse endsWith method', () => {
        const dsl = 'deny { tool.args.file.endsWith(".exe") }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.op).toBe('endsWith');
      });

      it('should parse contains method', () => {
        const dsl = 'deny { tool.args.content.contains("password") }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.op).toBe('contains');
      });

      it('should parse matches (regex) method', () => {
        const dsl = 'deny { tool.args.url.matches("^http://") }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.op).toBe('matches');
      });

      it('should parse comparison operators', () => {
        const gtDsl = 'deny { tool.args.size > 1000 }';
        const gtPolicy = policyEngine.parsePolicyDSL(gtDsl);
        expect(gtPolicy.condition.op).toBe('gt');

        const lteDsl = 'deny { tool.args.count <= 5 }';
        const ltePolicy = policyEngine.parsePolicyDSL(lteDsl);
        expect(ltePolicy.condition.op).toBe('lte');

        const neqDsl = 'deny { tool.args.status != "ok" }';
        const neqPolicy = policyEngine.parsePolicyDSL(neqDsl);
        expect(neqPolicy.condition.op).toBe('neq');
      });

      it('should parse nested property paths', () => {
        const dsl = 'deny { tool.args.config.options.unsafe == true }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.left.type).toBe('path');
        expect(policy.condition.left.path).toEqual(['tool', 'args', 'config', 'options', 'unsafe']);
      });

      it('should parse complex nested conditions', () => {
        const dsl = 'deny { (tool.name == "Write" && tool.args.path.startsWith("/core/")) || tool.name == "Delete" }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.type).toBe('or');
        expect(policy.condition.left.type).toBe('and');
      });

      it('should parse boolean literals', () => {
        const dsl = 'deny { tool.args.dangerous == true }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.right.value).toBe(true);
      });

      it('should parse number literals', () => {
        const dsl = 'deny { tool.args.attempts > 3 }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.right.value).toBe(3);
      });

      it('should parse string literals with escapes', () => {
        const dsl = 'deny { tool.args.pattern == "test\\"value" }';
        const policy = policyEngine.parsePolicyDSL(dsl);

        expect(policy.condition.right.value).toBe('test"value');
      });

      it('should throw on invalid DSL', () => {
        expect(() => policyEngine.parsePolicyDSL('invalid')).toThrow();
        expect(() => policyEngine.parsePolicyDSL('deny')).toThrow();
        expect(() => policyEngine.parsePolicyDSL('deny { }')).toThrow();
      });
    });

    describe('validateDSL', () => {
      it('should validate correct DSL', () => {
        const result = policyEngine.validateDSL('deny { tool.name == "Test" }');
        expect(result.valid).toBe(true);
        expect(result.parsed).toBeDefined();
      });

      it('should return error for invalid DSL', () => {
        const result = policyEngine.validateDSL('invalid syntax');
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });

  describe('Policy Management', () => {
    describe('addPolicyFromDSL', () => {
      it('should add a policy from DSL string', async () => {
        const id = await policyEngine.addPolicyFromDSL(
          'deny { tool.name == "DangerousTool" }',
          { name: 'Block Dangerous Tool' }
        );

        expect(id).toBeDefined();
        const policy = policyEngine.getPolicy(id);
        expect(policy).not.toBeNull();
        expect(policy.name).toBe('Block Dangerous Tool');
      });

      it('should emit policy:added event', async () => {
        const listener = vi.fn();
        mockEventBus.on('policy:added', listener);

        await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');

        expect(listener).toHaveBeenCalled();
      });
    });

    describe('addPolicy', () => {
      it('should add a policy from object', async () => {
        const id = await policyEngine.addPolicy({
          name: 'Test Policy',
          type: 'deny',
          condition: {
            type: 'comparison',
            op: 'eq',
            left: { type: 'path', path: ['tool', 'name'] },
            right: { type: 'literal', value: 'BadTool' }
          }
        });

        expect(id).toBeDefined();
        const policy = policyEngine.getPolicy(id);
        expect(policy.name).toBe('Test Policy');
      });

      it('should support legacy format with tool/argsPattern', async () => {
        const id = await policyEngine.addPolicy({
          name: 'Legacy Policy',
          type: 'deny',
          tool: 'WriteFile',
          argsPattern: {
            path: { startsWith: '/system/' }
          }
        });

        const policy = policyEngine.getPolicy(id);
        expect(policy).not.toBeNull();
      });

      it('should update existing policy with same ID', async () => {
        await policyEngine.addPolicyFromDSL(
          'deny { tool.name == "OldTool" }',
          { id: 'test-policy', name: 'Original' }
        );

        await policyEngine.addPolicyFromDSL(
          'deny { tool.name == "NewTool" }',
          { id: 'test-policy', name: 'Updated' }
        );

        const policies = policyEngine.getPolicies();
        const testPolicies = policies.filter(p => p.id === 'test-policy');
        expect(testPolicies.length).toBe(1);
        expect(testPolicies[0].name).toBe('Updated');
      });
    });

    describe('removePolicy', () => {
      it('should remove a policy', async () => {
        const id = await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');

        const result = await policyEngine.removePolicy(id);

        expect(result).toBe(true);
        expect(policyEngine.getPolicy(id)).toBeNull();
      });

      it('should return false for non-existent policy', async () => {
        const result = await policyEngine.removePolicy('nonexistent');
        expect(result).toBe(false);
      });

      it('should emit policy:removed event', async () => {
        const listener = vi.fn();
        mockEventBus.on('policy:removed', listener);

        const id = await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');
        await policyEngine.removePolicy(id);

        expect(listener).toHaveBeenCalledWith({ id });
      });
    });

    describe('setPolicyEnabled', () => {
      it('should enable/disable a policy', async () => {
        const id = await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');

        await policyEngine.setPolicyEnabled(id, false);
        let policy = policyEngine.getPolicy(id);
        expect(policy.enabled).toBe(false);

        await policyEngine.setPolicyEnabled(id, true);
        policy = policyEngine.getPolicy(id);
        expect(policy.enabled).toBe(true);
      });

      it('should exclude disabled policies from getPolicies', async () => {
        const id = await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');
        await policyEngine.setPolicyEnabled(id, false);

        const enabledPolicies = policyEngine.getPolicies();
        expect(enabledPolicies.find(p => p.id === id)).toBeUndefined();
      });
    });
  });

  describe('Policy Checking', () => {
    describe('check', () => {
      it('should allow tool when no policies match', async () => {
        const result = await policyEngine.check('ReadFile', { path: '/test.txt' });

        expect(result.allowed).toBe(true);
        expect(result.violations.length).toBe(0);
      });

      it('should deny tool when deny policy matches', async () => {
        await policyEngine.addPolicyFromDSL('deny { tool.name == "DeleteFile" }');

        const result = await policyEngine.check('DeleteFile', { path: '/important.txt' });

        expect(result.allowed).toBe(false);
        expect(result.violations.length).toBe(1);
        expect(result.violations[0].tool).toBe('DeleteFile');
      });

      it('should allow tool when allow policy matches first', async () => {
        await policyEngine.addPolicyFromDSL(
          'allow { tool.name == "ReadFile" && tool.args.path.startsWith("/safe/") }',
          { priority: 100 }
        );
        await policyEngine.addPolicyFromDSL(
          'deny { tool.name == "ReadFile" }',
          { priority: 50 }
        );

        const result = await policyEngine.check('ReadFile', { path: '/safe/data.txt' });

        expect(result.allowed).toBe(true);
        expect(result.explicitAllow).toBeDefined();
      });

      it('should check args conditions', async () => {
        await policyEngine.addPolicyFromDSL(
          'deny { tool.args.url.startsWith("http://") }'
        );

        const unsafeResult = await policyEngine.check('fetch', { url: 'http://evil.com' });
        expect(unsafeResult.allowed).toBe(false);

        const safeResult = await policyEngine.check('fetch', { url: 'https://safe.com' });
        expect(safeResult.allowed).toBe(true);
      });

      it('should emit policy:violation event', async () => {
        const listener = vi.fn();
        mockEventBus.on('policy:violation', listener);

        await policyEngine.addPolicyFromDSL('deny { tool.name == "BadTool" }');
        await policyEngine.check('BadTool', {});

        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toHaveProperty('tool', 'BadTool');
      });

      it('should emit policy:enforced event when blocking', async () => {
        const listener = vi.fn();
        mockEventBus.on('policy:enforced', listener);

        await policyEngine.addPolicyFromDSL('deny { tool.name == "BlockedTool" }');
        await policyEngine.check('BlockedTool', {});

        expect(listener).toHaveBeenCalled();
        expect(listener.mock.calls[0][0]).toHaveProperty('blocked', true);
      });

      it('should log violations to AuditLogger', async () => {
        await policyEngine.addPolicyFromDSL('deny { tool.name == "AuditedTool" }');
        await policyEngine.check('AuditedTool', {});

        expect(mockAuditLogger.logEvent).toHaveBeenCalledWith(
          'POLICY_VIOLATION',
          expect.objectContaining({ tool: 'AuditedTool' }),
          'WARN'
        );
      });

      it('should match contains operator', async () => {
        await policyEngine.addPolicyFromDSL(
          'deny { tool.args.content.contains("secret") }'
        );

        const result = await policyEngine.check('WriteFile', { content: 'This has a secret in it' });
        expect(result.allowed).toBe(false);
      });

      it('should match regex operator', async () => {
        await policyEngine.addPolicyFromDSL(
          'deny { tool.args.email.matches("^admin@") }'
        );

        const adminResult = await policyEngine.check('SendEmail', { email: 'admin@example.com' });
        expect(adminResult.allowed).toBe(false);

        const userResult = await policyEngine.check('SendEmail', { email: 'user@example.com' });
        expect(userResult.allowed).toBe(true);
      });

      it('should handle undefined paths gracefully', async () => {
        await policyEngine.addPolicyFromDSL(
          'deny { tool.args.nested.deep.value == "bad" }'
        );

        // Should not throw when path doesn't exist
        const result = await policyEngine.check('TestTool', {});
        expect(result.allowed).toBe(true);
      });
    });

    describe('Enforcement Modes', () => {
      it('should block in block mode', async () => {
        await policyEngine.setEnforcementMode('block');
        await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');

        const result = await policyEngine.check('Test', {});

        expect(result.allowed).toBe(false);
        expect(result.enforcementMode).toBe('block');
      });

      it('should warn but allow in warn mode', async () => {
        await policyEngine.setEnforcementMode('warn');
        await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');

        const result = await policyEngine.check('Test', {});

        expect(result.allowed).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.violations.length).toBeGreaterThan(0);
      });

      it('should allow and just log in audit mode', async () => {
        await policyEngine.setEnforcementMode('audit');
        await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');

        const result = await policyEngine.check('Test', {});

        expect(result.allowed).toBe(true);
        expect(result.violations.length).toBeGreaterThan(0);
      });

      it('should emit policy:mode_changed event', async () => {
        const listener = vi.fn();
        mockEventBus.on('policy:mode_changed', listener);

        await policyEngine.setEnforcementMode('warn');

        expect(listener).toHaveBeenCalledWith({ mode: 'warn' });
      });

      it('should reject invalid enforcement mode', async () => {
        await expect(policyEngine.setEnforcementMode('invalid'))
          .rejects.toThrow('Invalid enforcement mode');
      });
    });
  });

  describe('Condition Compilation', () => {
    describe('compileCondition', () => {
      it('should compile literal conditions', () => {
        const fn = policyEngine.compileCondition({ type: 'literal', value: true });
        expect(fn({})).toBe(true);
      });

      it('should compile path conditions', () => {
        const fn = policyEngine.compileCondition({
          type: 'path',
          path: ['tool', 'name']
        });

        expect(fn({ tool: { name: 'Test' } })).toBe('Test');
        expect(fn({ tool: {} })).toBeUndefined();
      });

      it('should compile comparison conditions', () => {
        const fn = policyEngine.compileCondition({
          type: 'comparison',
          op: 'eq',
          left: { type: 'path', path: ['value'] },
          right: { type: 'literal', value: 'test' }
        });

        expect(fn({ value: 'test' })).toBe(true);
        expect(fn({ value: 'other' })).toBe(false);
      });

      it('should compile AND conditions', () => {
        const fn = policyEngine.compileCondition({
          type: 'and',
          left: { type: 'literal', value: true },
          right: { type: 'literal', value: false }
        });

        expect(fn({})).toBe(false);
      });

      it('should compile OR conditions', () => {
        const fn = policyEngine.compileCondition({
          type: 'or',
          left: { type: 'literal', value: false },
          right: { type: 'literal', value: true }
        });

        expect(fn({})).toBe(true);
      });

      it('should compile NOT conditions', () => {
        const fn = policyEngine.compileCondition({
          type: 'not',
          expr: { type: 'literal', value: false }
        });

        expect(fn({})).toBe(true);
      });
    });
  });

  describe('VFS Integration', () => {
    it('should load policies from VFS on init', async () => {
      const vfsWithPolicies = {
        ...mockVFS,
        exists: vi.fn().mockImplementation((path) => {
          if (path === '/policies') return Promise.resolve(true);
          return Promise.resolve(false);
        }),
        list: vi.fn().mockResolvedValue(['/policies/test.json']),
        read: vi.fn().mockResolvedValue(JSON.stringify({
          policies: [{
            id: 'vfs-policy',
            name: 'VFS Policy',
            type: 'deny',
            dsl: 'deny { tool.name == "VFSTest" }'
          }]
        }))
      };

      const newEngine = PolicyEngineModule.factory({
        Utils: utils,
        VFS: vfsWithPolicies,
        EventBus: mockEventBus
      });

      await newEngine.init();

      const result = await newEngine.check('VFSTest', {});
      expect(result.allowed).toBe(false);
    });

    it('should save policies to VFS', async () => {
      await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');
      await policyEngine.savePoliciesToVFS('custom.json');

      expect(mockVFS.write).toHaveBeenCalledWith(
        '/policies/custom.json',
        expect.any(String)
      );
    });
  });

  describe('Export/Import', () => {
    it('should export policies', async () => {
      await policyEngine.addPolicyFromDSL(
        'deny { tool.name == "Export" }',
        { name: 'Export Test' }
      );

      const exported = policyEngine.exportPolicies();

      expect(exported.policies.length).toBeGreaterThan(0);
      expect(exported.exportedAt).toBeDefined();
      expect(exported.enforcementMode).toBe('block');
    });

    it('should import policies with merge', async () => {
      await policyEngine.addPolicyFromDSL(
        'deny { tool.name == "Existing" }',
        { id: 'existing-policy' }
      );

      const stats = await policyEngine.importPolicies({
        policies: [{
          id: 'imported-policy',
          name: 'Imported',
          type: 'deny',
          dsl: 'deny { tool.name == "Imported" }'
        }]
      }, true);

      expect(stats.imported).toBe(1);
      expect(policyEngine.getPolicy('existing-policy')).not.toBeNull();
      expect(policyEngine.getPolicy('imported-policy')).not.toBeNull();
    });

    it('should import policies with replace', async () => {
      await policyEngine.addPolicyFromDSL(
        'deny { tool.name == "ToReplace" }',
        { id: 'to-replace' }
      );

      const stats = await policyEngine.importPolicies({
        policies: [{
          id: 'new-policy',
          name: 'New',
          type: 'deny',
          dsl: 'deny { tool.name == "New" }'
        }]
      }, false);

      expect(stats.imported).toBe(1);
      expect(policyEngine.getPolicy('to-replace')).toBeNull();
      expect(policyEngine.getPolicy('new-policy')).not.toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should return accurate stats', async () => {
      await policyEngine.addPolicyFromDSL('deny { tool.name == "Deny1" }');
      await policyEngine.addPolicyFromDSL('deny { tool.name == "Deny2" }');
      await policyEngine.addPolicyFromDSL('allow { tool.name == "Allow1" }');

      const stats = policyEngine.getStats();

      expect(stats.policyCount).toBe(3);
      expect(stats.enabledCount).toBe(3);
      expect(stats.denyPolicies).toBe(2);
      expect(stats.allowPolicies).toBe(1);
      expect(stats.initialized).toBe(true);
    });
  });

  describe('Clear', () => {
    it('should clear all policies', async () => {
      await policyEngine.addPolicyFromDSL('deny { tool.name == "Test" }');
      await policyEngine.clear();

      const stats = policyEngine.getStats();
      expect(stats.policyCount).toBe(0);
    });

    it('should emit policy:cleared event', async () => {
      const listener = vi.fn();
      mockEventBus.on('policy:cleared', listener);

      await policyEngine.clear();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('Complex Policy Scenarios', () => {
    it('should handle multiple deny policies', async () => {
      await policyEngine.addPolicyFromDSL('deny { tool.name == "Delete" }', { priority: 100 });
      await policyEngine.addPolicyFromDSL('deny { tool.args.force == true }', { priority: 50 });

      const result = await policyEngine.check('Delete', { force: true });

      expect(result.allowed).toBe(false);
      // Should match the first deny policy (higher priority)
      expect(result.matchedPolicies.length).toBeGreaterThanOrEqual(1);
    });

    it('should support complex URL validation policy', async () => {
      await policyEngine.addPolicyFromDSL(`
        deny {
          tool.name == "fetch" &&
          !tool.args.url.startsWith("https://api.internal/") &&
          !tool.args.url.startsWith("https://trusted.com/")
        }
      `);

      const internalResult = await policyEngine.check('fetch', { url: 'https://api.internal/data' });
      expect(internalResult.allowed).toBe(true);

      const trustedResult = await policyEngine.check('fetch', { url: 'https://trusted.com/api' });
      expect(trustedResult.allowed).toBe(true);

      const externalResult = await policyEngine.check('fetch', { url: 'https://external.com/api' });
      expect(externalResult.allowed).toBe(false);
    });

    it('should support file path protection policy', async () => {
      await policyEngine.addPolicyFromDSL(`
        deny {
          (tool.name == "WriteFile" || tool.name == "DeleteFile") &&
          (tool.args.path.startsWith("/core/") || tool.args.path.startsWith("/system/"))
        }
      `);

      const coreWriteResult = await policyEngine.check('WriteFile', { path: '/core/module.js' });
      expect(coreWriteResult.allowed).toBe(false);

      const systemDeleteResult = await policyEngine.check('DeleteFile', { path: '/system/config.json' });
      expect(systemDeleteResult.allowed).toBe(false);

      const safeWriteResult = await policyEngine.check('WriteFile', { path: '/user/data.txt' });
      expect(safeWriteResult.allowed).toBe(true);
    });

    it('should handle priority-based policy ordering', async () => {
      // Lower priority deny
      await policyEngine.addPolicyFromDSL(
        'deny { tool.name == "ReadFile" }',
        { priority: 10 }
      );

      // Higher priority allow for safe paths
      await policyEngine.addPolicyFromDSL(
        'allow { tool.name == "ReadFile" && tool.args.path.startsWith("/public/") }',
        { priority: 100 }
      );

      const publicResult = await policyEngine.check('ReadFile', { path: '/public/data.txt' });
      expect(publicResult.allowed).toBe(true);

      const privateResult = await policyEngine.check('ReadFile', { path: '/private/secret.txt' });
      expect(privateResult.allowed).toBe(false);
    });
  });

  describe('Argument Sanitization', () => {
    it('should redact sensitive fields in violations', async () => {
      await policyEngine.addPolicyFromDSL('deny { tool.name == "Auth" }');

      const result = await policyEngine.check('Auth', {
        username: 'admin',
        password: 'supersecret',
        apiKey: 'key123'
      });

      // Check that logged violations have redacted args
      expect(mockAuditLogger.logEvent).toHaveBeenCalled();
      const loggedEvent = mockAuditLogger.logEvent.mock.calls[0][1];
      expect(loggedEvent.args.password).toBe('[REDACTED]');
      expect(loggedEvent.args.apiKey).toBe('[REDACTED]');
      expect(loggedEvent.args.username).toBe('admin');
    });
  });
});
