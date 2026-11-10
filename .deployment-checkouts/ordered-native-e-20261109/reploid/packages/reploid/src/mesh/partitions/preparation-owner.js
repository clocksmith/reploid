/** Retain preparation resources until each close succeeds; failed closes remain retryable. */
export function createPartitionPreparationOwner({ source, registerCleanup, onSettled = () => {}, errorMessage = 'Partition preparation cleanup failed' }) {
  let resident = null, release = null, commitAuthority = null, cleaning = null;
  let sourceSettled = false, releaseSettled = false, residentSettled = false;
  const sessions = new Set();
  const closeSources = async failures => {
    if (!sourceSettled) {
      try { await source.storage.close(); sourceSettled = true; } catch (error) { failures.push(error); }
    }
    if (release && !releaseSettled) {
      try { await release.close(); releaseSettled = true; } catch (error) { failures.push(error); }
    }
  };
  const owner = {
    set resident(value) { resident = value; },
    set release(value) { release = value; },
    set commitAuthority(value) { commitAuthority = value; },
    closeSources,
    trackSession(session) { sessions.add(session); return () => sessions.delete(session); },
    close() {
      return cleaning ||= (async () => {
        const failures = [];
        try { await commitAuthority?.close(); } catch (error) { failures.push(error); }
        if (!residentSettled) {
          try { await resident?.close(); residentSettled = true; } catch (error) { failures.push(error); }
        }
        for (const session of sessions) {
          try { await session.close(); sessions.delete(session); } catch (error) { failures.push(error); }
        }
        await closeSources(failures);
        if (failures.length === 1) throw failures[0];
        if (failures.length) throw new AggregateError(failures, errorMessage);
        await onSettled();
        releaseCleanup?.();
      })().catch(error => { cleaning = null; throw error; });
    }
  };
  const releaseCleanup = registerCleanup?.(owner);
  return owner;
}
