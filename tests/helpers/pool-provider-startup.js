/** Match the provider's structured and text-only terminal error projections. */
export function providerStartupError(snapshot) {
  const parsed = snapshot.parsed || {};
  if (snapshot.providerState === 'error' || parsed.status === 'error' || parsed.error
    || /^Error:/m.test(snapshot.raw || '')) {
    return parsed.reason || parsed.error || snapshot.raw || 'provider entered an error state';
  }
  return null;
}
