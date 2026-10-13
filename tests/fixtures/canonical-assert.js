/** Small cross-environment assertions for the shared source-only fixture. */
function assert(value, message = 'Fixture assertion failed') { if (!value) throw Error(message); }
assert.equal = (actual, expected, message) => assert(Object.is(actual, expected), message || `Expected ${String(expected)}, received ${String(actual)}`);
assert.rejects = async (operation, expected) => {
  try { await operation; } catch (error) { assert(expected.test(error.message), error.message); return; }
  throw Error('Expected fixture operation to reject');
};
export default assert;
