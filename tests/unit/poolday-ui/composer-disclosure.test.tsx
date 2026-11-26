// Who can read the prompt is shown beside the message field before Send, not kept for a screen reader only:
// the composer renders the host's disclosure sentence as visible text and the field and Send are described by it.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { composer as localComposer } from '../../../apps/poolday-react/src/app/designFixtures';
import type { ComposerView, ConversationCommands } from '../../../apps/poolday-react/src/features/chat/domain/conversation';
import { ComposerBar } from '../../../apps/poolday-react/src/features/chat/presentation/ComposerBar';

afterEach(cleanup);

const commands = new Proxy({}, { get: () => () => undefined }) as ConversationCommands;
const contributors = { ...localComposer.chip, source: 'Contributors', name: 'Gemma 27B', label: 'Answer on Contributors · Gemma 27B, Ready' };

// Each route as the host's conversation controller words it (apps/poolday/host/decisions/conversation-controller.js).
const routes: ReadonlyArray<readonly [route: string, view: ComposerView]> = [
  ['public contributors', { ...localComposer, chip: contributors, status: { text: '' }, disclosure: 'The answering computer can read your prompt.' }],
  ['private computers', { ...localComposer, chip: { ...contributors, source: 'Your private computers' },
    status: { text: 'This answer costs at most 48 service credits.' }, disclosure: 'The answering computer can read your prompt.' }],
  ['a split route', { ...localComposer, chip: contributors, status: { text: '' }, disclosure: 'Computers on this route can read the input for their own stages.' }],
  ['this device', { ...localComposer, disclosure: 'Nothing leaves this device.' }],
];

const mount = (view: ComposerView) => render(<ComposerBar composer={view} commands={commands} focusSignal={0} answerOnFocus={0} />);
const disclosure = () => document.querySelector('[data-prompt-disclosure]') as HTMLElement;
/** Shown to a sighted person: not screen-reader-only text, not hidden, and not removed from the accessibility tree. */
const shown = (node: Element) => !node.closest('.pool-visually-hidden, [hidden], [aria-hidden="true"]');

describe('ComposerBar prompt disclosure', () => {
  for (const [route, view] of routes) {
    it(`shows who can read the prompt before Send on ${route}`, () => {
      mount(view);
      const line = disclosure();
      expect(line.textContent).toBe(view.disclosure);
      expect(shown(line)).toBe(true);
      // The sentence is on the page once: the visible line is also the one assistive technology reads.
      expect(screen.getAllByText(view.disclosure)).toEqual([line]);
      expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('aria-describedby')).toBe(line.id);
      expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-describedby')).toBe(line.id);
      // It stands before the field, so a longer sentence never moves Send or covers the text.
      const field = document.querySelector('[data-composer-field]') as HTMLElement;
      expect(field.contains(line)).toBe(false);
      expect(line.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('follows the selection: the line changes with the route', () => {
    const { rerender } = mount(routes[3]![1]);
    expect(disclosure().textContent).toBe('Nothing leaves this device.');
    rerender(<ComposerBar composer={routes[0]![1]} commands={commands} focusSignal={0} answerOnFocus={0} />);
    expect(disclosure().textContent).toBe('The answering computer can read your prompt.');
    expect(shown(disclosure())).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Message' }).getAttribute('aria-describedby')).toBe(disclosure().id);
  });
});
