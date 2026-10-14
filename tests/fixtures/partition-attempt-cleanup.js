/* global chunks, memorySnapshot, resident, settleMemory */
/** Observe every attempt cleanup owner without replacing its primary failure. */
export async function observePartitionAttemptCleanup(pages, identity) {
  const result = { beforeClose: [], after: [], chunks: [], cleanupErrors: [] };
  for (const [index, page] of pages.entries()) {
    const observe = async (stage, operation, argument) => {
      try { return await page.evaluate(operation, argument); }
      catch (error) { const failure = { index, stage, message: error.message }; result.cleanupErrors.push(failure); return { error: error.message }; }
    };
    result.beforeClose.push(await observe('snapshot-before-close', () => memorySnapshot()));
    await observe('close-attempt', identity => resident.closeAttempt({ identity }), identity);
    result.after.push(await observe('settlement', () => settleMemory()));
    result.chunks.push(await observe('observed-chunks', () => chunks));
  }
  return result;
}
