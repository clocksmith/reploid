/**
 * @fileoverview Self Tester
 * Diagnostics for system health.
 */

const SelfTester = {
  metadata: {
    id: 'SelfTester',
    version: '1.0.0',
    dependencies: ['Utils', 'VFS', 'LLMClient'],
    async: true,
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, VFS, LLMClient } = deps;
    const { logger } = Utils;

    const runDiagnostics = async () => {
      const report = {
        timestamp: new Date().toISOString(),
        checks: []
      };

      // 1. Check VFS
      try {
        await VFS.list('/');
        report.checks.push({ name: 'VFS', status: 'OK' });
      } catch (e) {
        report.checks.push({ name: 'VFS', status: 'FAIL', error: e.message });
      }

      // 2. Check LLM Configuration
      if (LLMClient) {
        report.checks.push({ name: 'LLMClient', status: 'OK' });
      } else {
        report.checks.push({ name: 'LLMClient', status: 'FAIL' });
      }

      // 3. Storage Quota
      if (navigator.storage && navigator.storage.estimate) {
        try {
            const quota = await navigator.storage.estimate();
            const usedMB = (quota.usage / 1024 / 1024).toFixed(2);
            report.checks.push({ name: 'Storage', status: 'OK', details: `${usedMB}MB used` });
        } catch (e) {
            report.checks.push({ name: 'Storage', status: 'WARN', error: e.message });
        }
      }

      logger.info('[SelfTester] Diagnostics complete', report);
      return report;
    };

    return { runDiagnostics };
  }
};

export default SelfTester;
