/** The first remote request in a browser context shows the one-time contributor permission
 * (self/ui/pool-home/remote-permission.js); Allow is stored for that context, so later sends never ask. */
const allowed = new WeakSet();
export async function allowRemoteOnce(page, timeout = 30000) {
  const context = page.context();
  if (allowed.has(context)) return;
  await page.locator('[data-remote-permission] [data-remote-permission-allow]').click({ timeout });
  allowed.add(context);
}
