import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { composer as localComposer } from '../../../apps/poolday-react/src/app/designFixtures';
import type { ComposerView, ConversationCommands } from '../../../apps/poolday-react/src/features/chat/domain/conversation';
import { ComposerBar } from '../../../apps/poolday-react/src/features/chat/presentation/ComposerBar';

afterEach(cleanup);

const commands = new Proxy({}, { get: () => () => undefined }) as ConversationCommands;
const contributors = { ...localComposer.chip, source: 'Contributors', name: 'Gemma 27B', executionSource: 'network' as const, label: 'Answer on Contributors · Gemma 27B, Ready' };

// Each remote route as the host's conversation controller words it (apps/poolday/host/decisions/conversation-controller.js).
const remoteRoutes: ReadonlyArray<readonly [route: string, view: ComposerView]> = [
  ['public contributors', { ...localComposer, chip: contributors, status: { text: '' }, disclosure: 'The answering computer can read your prompt.' }],
  ['private computers', { ...localComposer, chip: { ...contributors, source: 'Your private computers' },
    status: { text: 'This answer costs at most 48 service credits.' }, disclosure: 'The answering computer can read your prompt.' }],
  ['a split route', { ...localComposer, chip: contributors, status: { text: '' }, disclosure: 'Computers on this route can read the input for their own stages.' }],
];
const localRoute: ComposerView = { ...localComposer, disclosure: 'Nothing leaves this device.' };

const mount = (view: ComposerView) => render(<ComposerBar composer={view} commands={commands} focusSignal={0} answerOnFocus={0} />);
const disclosure = () => document.querySelector('[data-prompt-disclosure]') as HTMLElement | null;
describe('ComposerBar prompt disclosure', () => {
  for (const [route, view] of remoteRoutes) {
    it(`omits ambient disclosure on ${route} and keeps the privacy control`, () => {
      mount(view);
      expect(disclosure()).toBeNull();
      expect(screen.queryByText(view.disclosure)).toBeNull();
      expect(document.querySelector('[data-open-privacy]')).not.toBeNull();
    });
  }

  it('omits the composer disclosure line when running locally on this device', () => {
    mount({ ...localRoute, status: { text: '' } });
    expect(disclosure()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('aria-describedby')).toBeNull();
  });

  it('gives a queued draft one status and one action without an ambient disclosure', () => {
    mount({
      ...remoteRoutes[0]![1],
      route: { ...remoteRoutes[0]![1].route, status: 'queued', send: 'none' },
      status: { text: 'Waiting for a computer.' },
      acquisition: { text: 'Checking model files.', progress: { value: 1, max: 2 } },
      nextAction: 'cancel-queued',
      optionalAction: 'download-local',
      send: { visible: true, disabled: true, mode: 'none' },
    });
    const row = document.querySelector('[data-composer-status-row]')!;
    expect(row.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(row.textContent).toContain('Waiting for a computer.');
    expect(row.querySelectorAll('button')).toHaveLength(1);
    expect(document.querySelector('[data-optional-download]')).toBeNull();
    expect(document.querySelector('[data-composer-model-source]')).toBeNull();
    expect(document.querySelector('[data-open-privacy]')?.textContent).not.toContain('Standard');
    expect(disclosure()).toBeNull();
  });

  it('does not bring back the status area when switching to contributors', () => {
    const { rerender } = mount(localRoute);
    rerender(<ComposerBar composer={remoteRoutes[0]![1]} commands={commands} focusSignal={0} answerOnFocus={0} />);
    expect(disclosure()).toBeNull();
    expect(document.querySelector('[data-composer-status-row]')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('aria-describedby')).toBeNull();
  });
});
