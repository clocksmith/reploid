import { expect } from '@playwright/test';

/**
 * Contribution and conversation steps through the current Poolday interface
 * (apps/poolday/ui/pool-home: network-controls.js, network-inspector.js,
 * contribution-models.js, conversation-workspace.js). Cached sharing is on by
 * default (dda9e4692): a fresh profile reads "On · waiting for a downloaded model"
 * until a model is downloaded, and then shares it without another click.
 */
export const CACHED_COMPUTE_DEFAULT = 'On · waiting for a downloaded model';
export const CACHED_FILES_DEFAULT = 'On · waiting for cached files';
/** conversation-workspace.js: the line under the composer while a sent message waits for a computer. */
export const QUEUED_MESSAGE = 'Finding a computer. Your message sends as soon as one is ready.';
/** library-adapter.js relayUnavailableReason: informational, connections continue direct-only. */
export const RELAY_DIRECT_ONLY = 'The relay service is unreachable. New connections are direct only, so some computers may not be reachable.';

/**
 * A private discovery room on the local signaling server. Without it, a page on
 * localhost joins the public swarm and the journey would be answered by, and
 * expose its prompts to, unrelated public computers.
 */
export const privateRoom = label => {
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `/?swarm=${label}-${suffix}&swarmToken=${label}-capability-${suffix}-0123456789abcdef0123456789`;
};

/** The network message, ignoring the informational direct-only relay notice. */
export const networkProblem = async page => {
  const text = (await page.locator('[data-network-message]').textContent()) || '';
  return text === RELAY_DIRECT_ONLY ? '' : text;
};

export async function openComputers(page) {
  if (!await page.locator('[data-inspector-pane="participants"]').isVisible()) {
    await page.locator('[data-inspector-section="participants"]').first().click();
  }
  await expect(page.locator('[data-inspector-pane="participants"]')).toBeVisible();
  const device = page.locator('[data-production-device]');
  if (!await device.evaluate(node => node.open)) await device.locator(':scope > summary').click();
}

export async function openStorage(page) {
  if (!await page.locator('[data-inspector-pane="settings"]').isVisible()) {
    await page.locator('[data-inspector-section="settings"]').first().click();
  }
  await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible();
  const options = page.locator('[data-model-sharing-limits]');
  if (!await options.evaluate(node => node.open)) await options.locator(':scope > summary').click();
}

/** Fresh profiles have compute and file sharing on, waiting for a downloaded model. */
export async function expectCachedSharingDefault(page) {
  await expect(page.locator('[data-contrib-label]')).toHaveText(CACHED_COMPUTE_DEFAULT);
  await expect(page.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-file-contribution-label]')).toHaveText(CACHED_FILES_DEFAULT);
  await expect(page.locator('[data-toggle-file-contribution]')).toHaveAttribute('aria-checked', 'true');
}

/**
 * Computers → Contribute this computer → a model (or adapter variant) → Download & share.
 * A whole model is downloaded from its catalog origin first; an adapter variant
 * prepares from verified pieces the mesh supplies. Returns the dialog's size line.
 */
export async function contributeModel(page, selectionId) {
  await openComputers(page);
  await page.locator(`[data-production-model="${selectionId}"]`).click();
  await expect(page.locator('[data-model-dialog]')).toBeVisible();
  await expect(page.locator('[data-download-confirm]')).toBeEnabled({ timeout: 60000 });
  const size = await page.locator('[data-download-size]').textContent();
  await page.locator('[data-download-confirm]').click();
  await expect(page.locator('[data-model-dialog]')).toBeHidden();
  return size;
}

/** Settings → Storage: seed one exact model's files, downloading the whole model within an allowance. */
export async function seedModelFiles(page, modelId, allowanceMiB) {
  await openStorage(page);
  const toggle = page.locator('[data-toggle-file-contribution]');
  // The default cached-only switch is on; it must be off before the model and mode can change.
  if (await toggle.getAttribute('aria-checked') === 'true') {
    await toggle.click();
    await expect(page.locator('[data-file-contribution-label]')).toHaveText('Not sharing');
  }
  await page.locator('[data-contribution-model]').selectOption(modelId);
  await page.locator('[data-file-mode]').selectOption('full-model');
  await page.locator('[data-file-download]').fill(String(allowanceMiB));
  await toggle.click();
}

/** Wait for this device's compute contribution to reach Ready, failing on any reported problem. */
export async function waitContributionReady(page, { timeout = 600000, log = null } = {}) {
  let last = '';
  await expect.poll(async () => {
    const state = { phase: await page.locator('[data-contrib-label]').textContent(),
      progress: await page.locator('[data-contribution-progress]').textContent(),
      error: await networkProblem(page),
      production: (await page.locator('[data-production-error]').textContent()) || '',
      inspector: (await page.locator('[data-inspector-error]').textContent()) || '' };
    const encoded = JSON.stringify(state);
    if (log && encoded !== last) { log(state); last = encoded; }
    if (state.error || state.production || state.inspector || state.phase === 'Failed') {
      throw new Error('Contribution failed: ' + (state.error || state.production || state.inspector || state.phase));
    }
    return state.phase;
  }, { timeout }).toBe('Ready');
}

/** Model picker: one pointer click on a model that can answer applies it (300e38c8f). */
export async function chooseModel(page, selectionId, { timeout = 60000 } = {}) {
  await page.locator('[data-open-model]').click();
  await expect(page.locator('[data-model-picker]')).toBeVisible();
  const choice = page.locator(`[data-model-picker] .chat-model-choices input[value="${selectionId}"]`).filter({ visible: true });
  await expect(choice).toBeVisible({ timeout });
  await expect(choice).toBeEnabled({ timeout });
  await choice.click();
  // The composer is inert until the modal picker closes; typing earlier is lost.
  await expect(page.locator('[data-model-picker]')).toBeHidden();
}

/** Current default network permission may already admit the request; older profiles ask once. */
export async function admitRemote(page, hasAttempt, { timeout = 30000 } = {}) {
  await expect.poll(async () => {
    const allow = page.locator('[data-remote-permission] [data-remote-permission-allow]');
    if (await allow.isVisible()) await allow.click();
    return hasAttempt();
  }, { timeout }).toBe(true);
}

/** Stop the active answer: its own Stop beside the answer, or the composer's when the answer is scrolled away. */
export async function stopAnswer(page) {
  await page.locator('[data-answer-stop]:visible, [data-composer-stop]:visible').first().click();
}
