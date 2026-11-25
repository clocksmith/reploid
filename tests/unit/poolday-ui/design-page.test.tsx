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
import { Composer } from '../../../apps/poolday-react/src/features/chat/presentation/Composer';
import { ModelSheet } from '../../../apps/poolday-react/src/features/chat/presentation/ModelSheet';
import { ThreadList } from '../../../apps/poolday-react/src/features/chat/presentation/ThreadList';
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
    expect(within(document.querySelector('[data-composition="ModelSheet"]') as HTMLElement).getByRole('dialog', { name: 'Answer on' })).toBeTruthy();
  });

  it('shows loading and failure states for token values', () => {
    const { unmount } = renderPage({ status: 'loading' });
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Reading tokens.css')).toBe(true);
    unmount();
    renderPage({ status: 'failed' });
    expect(screen.getAllByRole('alert').some((node) => node.textContent?.includes('tokens.css could not be read'))).toBe(true);
  });
});

describe('compositions', () => {
  it('model sheet: one computer, one model, the reason first and a primary that says what it does', async () => {
    const onComputer = vi.fn();
    const onCommit = vi.fn();
    const { rerender } = render(
      <ModelSheet presentation="inline" open state={fixtures.sheetReady} onClose={() => undefined} onComputer={onComputer} onModel={() => undefined} onCommit={onCommit} onWhoCanRead={() => undefined} />,
    );
    const computers = screen.getByRole('radiogroup', { name: 'Computer' });
    expect(within(computers).getAllByRole('radio').filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    await userEvent.click(within(computers).getByRole('radio', { name: 'Contributors' }));
    expect(onComputer).toHaveBeenCalledWith('network');
    await userEvent.click(screen.getByRole('button', { name: 'Answer on this device' }));
    expect(onCommit).toHaveBeenCalledOnce();
    rerender(
      <ModelSheet presentation="inline" open state={fixtures.sheetSearching} onClose={() => undefined} onComputer={onComputer} onModel={() => undefined} onCommit={onCommit} onWhoCanRead={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Answer with contributors' })).toHaveProperty('disabled', true);
    expect(screen.getAllByRole('status').some((node) => node.textContent?.startsWith('Finding computers'))).toBe(true);
  });

  it('composer: Enter sends a draft, Stop replaces Send while running, errors are alerts', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(
      <Composer state={{ ...fixtures.composer, draft: 'Hello' }} onDraft={() => undefined} onSend={onSend} onStop={onStop} onOpenAnswerOn={() => undefined} />,
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), '{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Answer on/ }).getAttribute('aria-haspopup')).toBe('dialog');
    rerender(<Composer state={{ ...fixtures.composer, running: true, error: 'Disconnected' }} onDraft={() => undefined} onSend={onSend} onStop={onStop} onOpenAnswerOn={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toContain('Disconnected');
  });

  it('thread list: exactly one current thread; the empty state says so', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ThreadList threads={fixtures.threads} current="t2" view="active" onView={() => undefined} onSelect={onSelect} onNew={() => undefined} />);
    expect(document.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /Recipe for four/ }));
    expect(onSelect).toHaveBeenCalledWith('t3');
    rerender(<ThreadList threads={[]} current={null} view="active" onView={() => undefined} onSelect={onSelect} onNew={() => undefined} />);
    expect(screen.getByText('No threads yet.')).toBeTruthy();
  });
});
