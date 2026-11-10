/** Keep an authoritative tokenizer acquisition failure visible during resident opening. */
export function createPartitionTokenizerGuard(storage) {
  let failure = null, guarded = storage;
  for (const name of ['loadTokenizerJson', 'loadTokenizerModel']) {
    if (typeof storage[name] !== 'function') continue;
    if (guarded === storage) guarded = { ...storage };
    guarded[name] = async (...args) => {
      try { return await storage[name](...args); }
      catch (error) { failure ||= { error }; throw error; }
    };
  }
  return Object.freeze({
    storage: guarded,
    assertAvailable() { if (failure) throw failure.error; },
    explain(error) {
      if (!failure || error === failure.error) return error;
      const cause = failure.error;
      return new AggregateError([cause, error], cause?.message || String(cause), { cause });
    }
  });
}
