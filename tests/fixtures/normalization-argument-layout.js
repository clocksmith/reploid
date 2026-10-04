/** Argument positions at the named Doppler interception boundary, not its caller. */
const layouts = Object.freeze({
  doRMSNorm: Object.freeze({ input: 0, weight: 1, epsilon: 2, options: 3, recorder: 4 }),
  runRMSNorm: Object.freeze({ input: 0, weight: 1, epsilon: 2, options: 3, recorder: null }),
  recordRMSNorm: Object.freeze({ input: 1, weight: 2, epsilon: 3, options: 4, recorder: 0 }),
});
export function normalizationArgumentLayout(functionName) {
  if (!Object.hasOwn(layouts, functionName)) throw Error(`Unknown normalization interception: ${functionName}`);
  return layouts[functionName];
}
