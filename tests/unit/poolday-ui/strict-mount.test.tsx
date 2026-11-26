// React StrictMode runs each effect twice in development builds (mount, unmount, mount). The product must come
// through that as one product: a host the page adopted stays open, and the conversation keeps one view state, so
// an invite link read by the first mount is still there for the second.
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const controllers = vi.hoisted(() => ({ options: [] as { viewState: object }[] }));
vi.mock('../../../apps/poolday-react/src/app/ProductWorkspace', async () => {
  const { createElement } = await import('react');
  return { ProductWorkspace: () => createElement('span', { 'data-workspace-open': '' }) };
});
vi.mock('../../../apps/poolday/host/decisions/conversation-controller.js', () => ({
  createConversationController: (_session: object, options: { viewState: object }) => { controllers.options.push(options); return options; },
}));
import { mountPoolday } from '../../../apps/poolday-react/src/main-app';
import { createConversation } from '../../../apps/poolday-react/src/features/chat/infrastructure/conversation';

afterEach(() => { cleanup(); controllers.options.length = 0; });

it('keeps an adopted host open through the doubled mount, and closes it when the page unmounts', async () => {
  const host = { close: vi.fn(async () => undefined) };
  const root = document.body.appendChild(document.createElement('div'));
  const unmount = mountPoolday(root, { host });
  await waitFor(() => expect(root.querySelector('[data-workspace-open]')).not.toBeNull());
  expect(host.close).not.toHaveBeenCalled();
  unmount();
  await waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
  root.remove();
});

it('gives one product one conversation view state, and another product its own', () => {
  const product = { host: { chat: {} } };
  createConversation(product); createConversation(product);
  createConversation({ host: { chat: {} } });
  const supplied = {};
  createConversation(product, supplied);
  const [first, second, other, fixture] = controllers.options.map(options => options.viewState);
  expect(second).toBe(first);
  expect(other).not.toBe(first);
  expect(fixture).toBe(supplied);
});
