/** The first remote request in a browser context may show the one-time contributor permission
 * (Network answers in Settings). When network answers are already on, the permission is granted
 * without a prompt and the attempt records it as its authorization; either way it is recorded once. */
const allowed = new WeakSet();
export async function allowRemoteOnce(page, timeout = 5000) {
  const context = page.context();
  if (allowed.has(context)) return;
  const allow = page.locator('[data-remote-permission] [data-remote-permission-allow]');
  if (await allow.waitFor({ state: 'visible', timeout }).then(() => true, () => false)) await allow.click();
  allowed.add(context);
}
