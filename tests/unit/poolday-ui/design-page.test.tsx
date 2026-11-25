// The /design page and the compositions it documents.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesignPage, type TokenValueState } from '../../../apps/poolday-react/src/features/design/presentation/DesignPage';
import { parseTokenValues } from '../../../apps/poolday-react/src/features/design/infrastructure/tokenSource';
import { designIndex } from '../../../apps/poolday-react/src/app/designIndex.generated';
import { compositionSpecimens } from '../../../apps/poolday-react/src/app/designSpecimens';
import * as fixtures from '../../../apps/poolday-react/src/app/designFixtures';
import type { ConversationCommands } from '../../../apps/poolday-react/src/features/chat/domain/conversation';
import { ComposerBar } from '../../../apps/poolday-react/src/features/chat/presentation/ComposerBar';
import { DownloadDialog } from '../../../apps/poolday-react/src/features/chat/presentation/ChatDialogs';
import { buildDesignIndex, renderDesignIndex } from '../../../scripts/build-poolday-design-index.mjs';

const repo = resolve(import.meta.dirname, '..', '..', '..');
const tokensCss = readFileSync(resolve(repo, 'apps/poolday/styles/poolday/tokens.css'), 'utf8');

afterEach(cleanup);

function renderPage(values: TokenValueState = { status: 'ready', values: parseTokenValues(tokensCss) }) {
  return render(<DesignPage index={designIndex} tokenValues={values} compositions={compositionSpecimens} theme="dark" onTheme={() => undefined} />);
}

describe('design index', () => {
  it('is generated from the current sources', () => {
    expect(readFileSync(resolve(repo, 'apps/poolday-react/src/app/designIndex.generated.ts'), 'utf8')).toBe(renderDesignIndex(buildDesignIndex()));
  });

  it('links tokens, primitives and compositions in both directions', () => {
    for (const primitive of designIndex.primitives) {
      for (const name of primitive.tokens) expect(designIndex.tokens.find((token) => token.name === name)?.primitives).toContain(primitive.name);
      for (const name of primitive.compositions) expect(designIndex.compositions.find((entry) => entry.name === name)?.primitives).toContain(primitive.name);
    }
    expect(designIndex.compositions.map((entry) => entry.name)).toEqual(compositionSpecimens.map((specimen) => specimen.name));
  });

  it('reads declared values per theme from tokens.css', () => {
    const values = parseTokenValues(tokensCss);
    expect(values.get('--pool-gray-44')).toEqual({ dark: '#717171', light: null });
    expect(values.get('--pool-color-ink')).toEqual({ dark: 'var(--pool-void-ink)', light: 'var(--pool-silica-ink)' });
  });
});

describe('design page', () => {
  it('orders tokens, then primitives, then compositions, built from poolday-ui only', () => {
    const { container } = renderPage();
    const sections = ['tokens', 'primitives', 'compositions'].map((id) => document.getElementById(id) as HTMLElement);
    expect(sections.map((heading) => heading.textContent)).toEqual(['Tokens', 'Primitives', 'Compositions']);
    expect(sections[0]!.compareDocumentPosition(sections[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sections[1]!.compareDocumentPosition(sections[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.firstElementChild?.className).toBe('pool-home');
    // Every class on the page is a primitive class from the design system.
    const classes = new Set([...container.querySelectorAll('[class]')].flatMap((node) => [...node.classList]));
    for (const name of classes) expect(name, name).toMatch(/^(pool|btn)-/);
  });

  it('shows exactly one current navigator item', async () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Design system sections' });
    const current = () => within(nav).getAllByRole('link').filter((link) => link.getAttribute('aria-current'));
    expect(current()).toHaveLength(1);
    await userEvent.click(within(nav).getByRole('link', { name: 'Sheet' }));
    expect(current().map((link) => link.textContent)).toEqual(['Sheet']);
  });

  it('marks unused tokens and lists what uses each one', () => {
    renderPage();
    const unused = designIndex.tokens.filter((token) => token.uses === 0).length;
    expect(screen.queryAllByText('Unused')).toHaveLength(unused);
    const ink = document.querySelector('[data-token="--pool-color-ink"]') as HTMLElement;
    expect(ink.textContent).toContain('Used by: ');
    expect(ink.textContent).toContain('Button');
  });

  it('renders a live specimen for every primitive and every composition', () => {
    renderPage();
    for (const primitive of designIndex.primitives) {
      const article = document.querySelector(`[data-primitive="${primitive.name}"]`) as HTMLElement;
      expect(article, primitive.name).toBeTruthy();
      expect(within(article).getByRole('heading', { level: 3, name: primitive.name })).toBeTruthy();
    }
    for (const composition of designIndex.compositions) {
      const article = document.querySelector(`[data-composition="${composition.name}"]`) as HTMLElement;
      const frame = within(article).getByRole('figure');
      expect(frame.textContent?.trim().length, composition.name).toBeGreaterThan(20);
    }
    expect(within(document.querySelector('[data-composition="AnswerOnSheet"]') as HTMLElement).getByRole('dialog', { name: 'Answer on' })).toBeTruthy();
  });

  it('shows loading and failure states for token values', () => {
    const { unmount } = renderPage({ status: 'loading' });
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Reading tokens.css')).toBe(true);
    unmount();
    renderPage({ status: 'failed' });
    expect(screen.getAllByRole('alert').some((node) => node.textContent?.includes('tokens.css could not be read'))).toBe(true);
  });
});

const commands = (overrides: Partial<ConversationCommands> = {}) =>
  new Proxy(overrides, { get: (target, key) => (target as Record<string | symbol, unknown>)[key] ?? (() => undefined) }) as ConversationCommands;

describe('compositions', () => {
  it('composer: Enter sends a draft, Stop replaces Send while running, and the next action follows the status', async () => {
    const send = vi.fn();
    const stop = vi.fn();
    const cancelQueuedSend = vi.fn();
    const { rerender } = render(<ComposerBar composer={{ ...fixtures.composer, draft: 'Hello' }} commands={commands({ send, stop })} focusSignal={0} answerOnFocus={0} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), '{Enter}');
    expect(send).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /^Answer on This device/ }).getAttribute('aria-haspopup')).toBe('dialog');
    rerender(<ComposerBar composer={fixtures.composerRunning} commands={commands({ send, stop })} focusSignal={0} answerOnFocus={0} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stop).toHaveBeenCalledOnce();
    rerender(<ComposerBar composer={fixtures.composerQueued} commands={commands({ cancelQueuedSend })} focusSignal={0} answerOnFocus={0} />);
    expect(document.querySelector('[data-model-status]')?.textContent).toBe('Waiting for a computer running Gemma 27B…');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancelQueuedSend).toHaveBeenCalledOnce();
  });

  it('download: the size is checked before the primary can download', async () => {
    const confirmDownload = vi.fn();
    const { rerender } = render(<DownloadDialog presentation="inline" download={fixtures.downloadChecking} commands={commands({ confirmDownload })} />);
    expect((screen.getByRole('button', { name: 'Download model' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-download-size]')?.textContent).toBe('Checking download size…');
    rerender(<DownloadDialog presentation="inline" download={fixtures.downloadReady} commands={commands({ confirmDownload })} />);
    expect(document.querySelector('[data-download-size]')?.textContent).toBe('640 MB download');
    await userEvent.click(screen.getByRole('button', { name: 'Download model' }));
    expect(confirmDownload).toHaveBeenCalledOnce();
  });
});
