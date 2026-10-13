/** Shared signed resident lifecycle. Hosts supply admission, release policy and Doppler. */
export function createSignedResidentFactory({ createFactory, openCapsule, model, artifactStore,
  release, assertSession, closeSources, trackSession, canonical = false, onVerification = () => {} }) {
  if (typeof canonical !== 'boolean') throw new Error('Explicit canonical signed factory mode required');
  if (typeof trackSession !== 'function') throw new Error('Signed resident requires an explicit session cleanup owner');
  return createFactory({ capsuleOptions: { ...release.options, artifactStore },
    async openCapsule(capsule, options) {
      const session = await openCapsule(capsule, options);
      const settled = trackSession(session);
      try {
        await assertSession(model, session);
        await release.assertCurrent(session);
        onVerification(session.verification);
        const partition = session.residentPartition;
        if (!partition) throw new Error('Capsule opener did not return a qualified resident');
        const canonicalMethods = ['admitCanonicalPrompt', 'executeCanonicalGroup0', 'executeCanonicalGroup1', 'commitCanonicalTransition'];
        if (canonical && (typeof partition.getCanonicalGeneration !== 'function'
          || canonicalMethods.some(name => typeof partition[name] !== 'function'))) {
          throw new Error('Signed resident lacks declared canonical execution methods');
        }
        let closing = null, sessionSettled = false;
        const invoke = async (method, request) => {
          await release.assertCurrent(session);
          const failures = []; let result;
          try { result = await partition[method](request); } catch (error) { failures.push(error); }
          try { await release.assertCurrent(session); } catch (error) { failures.push(error); }
          if (failures.length === 1) throw failures[0];
          if (failures.length) throw new AggregateError(failures, 'Resident computation and authorization failed');
          return result;
        };
        return { ...session, residentPartition: Object.freeze({ ...partition,
          ...(canonical ? Object.fromEntries(canonicalMethods.map(name => [name, request => invoke(name, request)])) : {}),
          ...(typeof partition.executeStage === 'function' ? { executeStage: request => invoke('executeStage', request) } : {}),
          tokenize: request => invoke('tokenize', request),
          executeGroup0: request => invoke('executeGroup0', request),
          executeGroup1: request => invoke('executeGroup1', request),
          close() {
            if (!closing) closing = (async () => {
              const failures = [];
              if (!sessionSettled) {
                try { await session.close(); sessionSettled = true; settled(); } catch (error) { failures.push(error); }
              }
              await closeSources(failures);
              if (failures.length) throw new AggregateError(failures, 'Signed resident cleanup failed');
            })().catch(error => { closing = null; throw error; });
            return closing;
          }
        }) };
      } catch (error) {
        try { await session.close(); settled(); } catch (cleanup) {
          throw new AggregateError([error, cleanup], 'Signed resident admission and cleanup failed');
        }
        throw error;
      }
    }
  });
}
