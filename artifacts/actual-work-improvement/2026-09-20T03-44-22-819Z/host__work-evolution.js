/** Application-selected tools, protected suites, persistence and activation permission. */
import { createCodeEvolution, createImprovementLedger } from '../vendor/reploid/improvement/index.js';
import { ensureIdentityBundle } from '../identity.js';
import { runIsolatedCode, verifyCandidateCode } from '../infrastructure/code-sandbox.js';
import policy from '../config/work-evolution.json' with { type: 'json' };

export function createWorkEvolution({ storage, locks = navigator.locks, isBusy, onChange = () => {} }) {
  const prefix = policy.storageKey + ':evidence:';
  const write = async (path, content) => {
    if (new TextEncoder().encode(content).byteLength > policy.maxStoredBytes) throw new Error('Improvement evidence exceeds storage allowance');
    storage.setItem(prefix + path, content);
  };
  const VFS = { exists: async path => storage.getItem(prefix + path) !== null,
    read: async path => { const value = storage.getItem(prefix + path); if (value === null) throw new Error('Evidence not found'); return value; }, write };
  const ledger = createImprovementLedger({ VFS, getIdentity: () => ensureIdentityBundle({ storage, instanceId: 'work-improvement-recorder' }) });
  return createCodeEvolution({ targets: policy.targets, policy: Object.fromEntries(Object.entries(policy).filter(([key]) => key !== 'targets')),
    ports: { ledger,
      load: async () => { const raw = storage.getItem(policy.storageKey); return raw ? JSON.parse(raw) : null; },
      save: async value => {
        const text = JSON.stringify(value);
        if (new TextEncoder().encode(text).byteLength > policy.maxStoredBytes) throw new Error('Improvement history is full');
        storage.setItem(policy.storageKey, text);
      },
      lock: operation => locks.request(policy.storageKey, operation),
      execute: (code, input, { signal }) => runIsolatedCode(code, input, { signal, timeoutMs: policy.timeoutMs, maxResultBytes: policy.maxResultBytes }),
      verify: (code, signal) => verifyCandidateCode(code, policy.verificationTimeoutMs, signal),
      writeEvidence: (path, value) => write(path, JSON.stringify(value)),
      authorize: () => !isBusy(), onChange
    }
  });
}
