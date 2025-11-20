/**
 * @fileoverview Verification Worker
 * Runs in a Web Worker sandbox to safely test code.
 * Used by VerificationManager.
 */

self.onmessage = async (e) => {
  const { type, snapshot } = e.data;

  if (type === 'VERIFY') {
    try {
      // 1. Static Analysis (Syntax Check)
      const errors = [];
      for (const [path, code] of Object.entries(snapshot)) {
        if (path.endsWith('.js')) {
          try {
            new Function(code); // Syntax check only
          } catch (err) {
            errors.push(`Syntax Error in ${path}: ${err.message}`);
          }
        }
      }

      if (errors.length > 0) {
        self.postMessage({ passed: false, reason: 'Syntax Errors', errors });
        return;
      }

      // 2. Structural Analysis (Heuristics)
      // Ensure core modules export a factory
      const coreModules = Object.keys(snapshot).filter(k => k.startsWith('/core/') && k.endsWith('.js'));

      for (const path of coreModules) {
        const code = snapshot[path];
        if (!code.includes('factory') && !code.includes('export default')) {
          errors.push(`${path} missing factory/export pattern`);
        }
      }

      if (errors.length > 0) {
        self.postMessage({ passed: false, reason: 'Structural Errors', errors });
        return;
      }

      // 3. Success
      self.postMessage({ passed: true });
    } catch (err) {
      self.postMessage({ passed: false, reason: `Worker Logic Crash: ${err.message}` });
    }
  }
};
