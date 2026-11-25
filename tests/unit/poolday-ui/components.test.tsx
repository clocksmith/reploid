// Interaction and accessibility of each @reploid/poolday-ui primitive: roles, names, keyboard
// operation, disabled and selected states, and the primitive classes each one renders.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Card,
  Chip,
  Columns,
  Dialog,
  Disclosure,
  Divider,
  Facts,
  Field,
  Frame,
  Grow,
  Icon,
  IconButton,
  InputGroup,
  List,
  ListItem,
  Log,
  MultiChoice,
  Navigator,
  Notice,
  PooldayRoot,
  Progress,
  Prose,
  Row,
  Section,
  Sheet,
  SidebarLayout,
  SingleChoice,
  Spinner,
  Stack,
  StatusLine,
  Surface,
  Text,
  TextArea,
  Toggle,
  TokenSwatch,
  VisuallyHidden,
  Wordmark,
} from '@reploid/poolday-ui';

afterEach(cleanup);

describe('scope, text and layout', () => {
  it('scopes tokens to a themed root and renders text roles from the type scale', () => {
    const { container } = render(
      <PooldayRoot theme="light" data={{ 'data-test-root': true }}>
        <Text variant="title" as="h1">
          Title
        </Text>
        <Text muted mono>
          id
        </Text>
        <VisuallyHidden>Hidden name</VisuallyHidden>
        <Wordmark />
      </PooldayRoot>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('pool-home');
    expect(root.dataset.poolTheme).toBe('light');
    expect(root.hasAttribute('data-test-root')).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' }).className).toBe('pool-title');
    // Mono text also wraps anywhere: an identifier has no spaces to break at.
    expect(screen.getByText('id').className).toBe('pool-body pool-muted pool-mono pool-break');
    expect(screen.getByText('Hidden name').className).toBe('pool-visually-hidden');
  });

  it('lays out with token gaps only', () => {
    const { container } = render(
      <Stack gap="lg">
        <Row justify="between" gap="xs">
          <Grow />
        </Row>
        <Columns gap="sm">x</Columns>
        <Divider />
        <Log label="Messages">m</Log>
      </Stack>,
    );
    expect(container.querySelector('.pool-stack.pool-gap-lg')).toBeTruthy();
    expect(container.querySelector('.pool-row.pool-gap-xs.pool-row-between')).toBeTruthy();
    expect(container.querySelector('.pool-columns.pool-gap-sm')).toBeTruthy();
    expect(container.querySelector('hr.pool-divider')).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Messages' }).getAttribute('aria-live')).toBe('polite');
  });

  it('keeps data attributes to data-* keys', () => {
    const data = { 'data-ok': 'yes', class: 'x', style: 'color:red' } as unknown as Record<`data-${string}`, string>;
    const { container } = render(<Surface data={data}>s</Surface>);
    const element = container.firstElementChild as HTMLElement;
    expect(element.getAttribute('data-ok')).toBe('yes');
    expect(element.getAttribute('style')).toBeNull();
    expect(element.className).toBe('pool-card');
  });

  it('renders surfaces, a card, a frame and facts', () => {
    render(
      <>
        <Surface variant="well">w</Surface>
        <Card title="Desktop" status="Ready" actions={<Badge>a</Badge>}>
          body
        </Card>
        <Frame width="narrow" label="Phone">
          f
        </Frame>
        <Facts items={[['Model', 'Qwen']]} />
      </>,
    );
    expect(screen.getByText('w').className).toBe('pool-well');
    expect(screen.getByRole('heading', { name: 'Desktop' })).toBeTruthy();
    expect(screen.getByRole('figure', { name: 'Phone' }).className).toBe('pool-frame pool-frame-narrow');
    expect(screen.getByText('Model').tagName).toBe('DT');
  });
});

describe('buttons', () => {
  it('runs an enabled action, and is disabled without one or while pending', async () => {
    const onPress = vi.fn();
    const { rerender } = render(<Button variant="primary" label="Send" icon="send" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button.className).toBe('pool-button btn-primary');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<Button variant="primary" label="Send" pending pendingLabel="Sending" onPress={onPress} />);
    const pending = screen.getByRole('button', { name: 'Sending' });
    expect(pending).toHaveProperty('disabled', true);
    expect(pending.getAttribute('aria-busy')).toBe('true');
    rerender(<Button label="Nothing" />);
    expect(screen.getByRole('button', { name: 'Nothing' })).toHaveProperty('disabled', true);
  });

  it('is operable from the keyboard and reports pressed and current states', async () => {
    const onPress = vi.fn();
    render(
      <>
        <Button variant="quiet" label="Search" pressed onPress={onPress} />
        <Button variant="quiet" label="Docs" href="/docs" current />
      </>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search' }));
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onPress).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Search' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('aria-current')).toBe('page');
  });

  it('names an icon button by its label and hides its glyph', async () => {
    const onPress = vi.fn();
    const { container } = render(<IconButton label="Close" icon="close" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Close' });
    expect(button.className).toBe('pool-button pool-icon btn-ghost');
    expect(container.querySelector('.pool-icon-box')?.getAttribute('aria-hidden')).toBe('true');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('fills a suggestion chip', async () => {
    const onPress = vi.fn();
    render(<Chip label="Explain WebGPU" onPress={onPress} />);
    await userEvent.click(screen.getByRole('button', { name: 'Explain WebGPU' }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('renders an icon in its centred box', () => {
    const { container } = render(<Icon name="check" size="sm" />);
    expect(container.firstElementChild?.className).toBe('pool-icon-box pool-icon-box-sm');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
  });
});

describe('fields', () => {
  function Controlled({ error }: { readonly error?: string }) {
    const [value, setValue] = useState('');
    return <Field label="Thread name" value={value} onChange={setValue} hint="Up to 256 characters." error={error} />;
  }

  it('labels the field, links its hint and announces its error', async () => {
    const { rerender } = render(<Controlled />);
    const input = screen.getByRole('textbox', { name: 'Thread name' });
    await userEvent.type(input, 'Notes');
    expect((input as HTMLInputElement).value).toBe('Notes');
    expect(screen.getByText('Up to 256 characters.').id).toBe(input.getAttribute('aria-describedby'));
    rerender(<Controlled error="Too long" />);
    const invalid = screen.getByRole('textbox', { name: 'Thread name' });
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(`${invalid.id}-error`) as HTMLElement;
    expect(error.textContent).toBe('Too long');
    expect(error.getAttribute('aria-live')).toBe('polite');
    expect(invalid.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('submits a text area on Enter and adds a line on Shift+Enter', async () => {
    const onSubmit = vi.fn();
    function Composer() {
      const [value, setValue] = useState('');
      return (
        <InputGroup activity="executing">
          <TextArea bare label="Message" labelHidden value={value} onChange={setValue} onSubmit={onSubmit} />
        </InputGroup>
      );
    }
    const { container } = render(<Composer />);
    const area = screen.getByRole('textbox', { name: 'Message' });
    expect(area.className).toBe('pool-bare pool-body');
    expect(container.querySelector('.pool-input-group')?.getAttribute('data-activity')).toBe('executing');
    await userEvent.type(area, 'one{Shift>}{Enter}{/Shift}two');
    expect((area as HTMLTextAreaElement).value).toBe('one\ntwo');
    await userEvent.type(area, '{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('choices', () => {
  const options = [
    { value: 'local', title: 'This device', status: 'Ready' },
    { value: 'desktop', title: 'Your desktop', status: 'Offline', disabled: true, fix: { label: 'Connect', onPress: vi.fn() } },
    { value: 'network', title: 'Contributors', status: 'Ready' },
  ] as const;

  function One({ layout = 'list' as 'list' | 'segmented' }) {
    const [value, setValue] = useState<'local' | 'desktop' | 'network'>('local');
    return <SingleChoice label="Computer" value={value} onChange={setValue} options={options} layout={layout} />;
  }

  it('is a radio group with exactly one checked row, a status line and a fix for a disabled row', async () => {
    render(<One />);
    const group = screen.getByRole('radiogroup', { name: 'Computer' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.filter((radio) => (radio as HTMLInputElement).checked)).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'This device' }).getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Your desktop' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Connect' }).className).toContain('pool-option-fix');
    await userEvent.click(screen.getByText('Contributors'));
    expect(screen.getByRole('radio', { name: 'Contributors' })).toHaveProperty('checked', true);
    expect(screen.getByRole('radio', { name: 'This device' })).toHaveProperty('checked', false);
  });

  it('moves the choice with arrow keys and keeps one tab stop', async () => {
    render(<One layout="segmented" />);
    const local = screen.getByRole('radio', { name: 'This device' });
    await userEvent.tab();
    expect(document.activeElement).toBe(local);
    await userEvent.keyboard('{ArrowRight}');
    // The disabled radio is skipped by the platform.
    expect(screen.getByRole('radio', { name: 'Contributors' })).toHaveProperty('checked', true);
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Contributors' }));
  });

  it('is a group of independent checkboxes', async () => {
    const onChange = vi.fn();
    render(
      <MultiChoice
        label="Share"
        values={['files']}
        onChange={onChange}
        options={[
          { value: 'files', title: 'Model files' },
          { value: 'connection', title: 'Connection' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Share' }).className).toBe('pool-options pool-options-multi');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Connection' }));
    expect(onChange).toHaveBeenCalledWith(['files', 'connection']);
  });

  it('switches a toggle with the keyboard and reports its state', async () => {
    function T() {
      const [on, setOn] = useState(false);
      return <Toggle title="Network answers" status={on ? 'On' : 'Off'} checked={on} onChange={setOn} />;
    }
    render(<T />);
    const toggle = screen.getByRole('switch', { name: 'Network answers' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.focus();
    await userEvent.keyboard(' ');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('On').id).toBe(toggle.getAttribute('aria-describedby'));
  });
});

describe('rows and sections', () => {
  it('renders actions, destinations, the one current row and static rows on one grid', async () => {
    const onPress = vi.fn();
    render(
      <Section title="Computers" note="Paired desktops answer only you.">
        <List>
          <ListItem title="Action" status="Runs" onPress={onPress} icon="device" />
          <ListItem title="Destination" href="/settings" />
          <ListItem title="Current" current onPress={() => undefined} />
          <ListItem title="Static" trailing={<Badge tone="ready">Ready</Badge>} />
        </List>
      </Section>,
    );
    expect(screen.getByRole('region', { name: 'Computers' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Action/ }));
    expect(onPress).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: /Destination/ }).className).toBe('pool-action-row pool-plain');
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(screen.getByText('Static').closest('.pool-row-static')).toBeTruthy();
    expect(screen.getByText('Ready').className).toBe('pool-badge pool-tone-ready');
  });

  it('discloses detail natively', () => {
    const { container } = render(
      <Disclosure summary="Receipt" status="1.4 s" quiet>
        <Text>inside</Text>
      </Disclosure>,
    );
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.className).toBe('pool-disclosure pool-disclosure-quiet');
    fireEvent.click(container.querySelector('summary') as HTMLElement);
    expect(details.open).toBe(true);
  });
});

describe('feedback', () => {
  it('announces notices from regions that exist before any message', () => {
    const { rerender } = render(<Notice tone="error" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('');
    rerender(<Notice tone="error">Disconnected</Notice>);
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert.textContent).toBe('Disconnected');
  });

  it('labels progress and spinners, and reserves a status line', () => {
    render(
      <>
        <Progress label="Download" value={0.5} />
        <Progress label="Preparing" />
        <Spinner label="Loading" />
        <StatusLine />
        <Badge tone="error">Failed</Badge>
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Download' }).getAttribute('value')).toBe('0.5');
    expect(screen.getByRole('progressbar', { name: 'Preparing' }).hasAttribute('value')).toBe(false);
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Loading')).toBe(true);
    expect(document.querySelector('.pool-status-line')).toBeTruthy();
  });

  it('previews a token through a parameter only', () => {
    const { container } = render(<TokenSwatch name="--pool-color-ink" kind="color" />);
    const swatch = container.firstElementChild as HTMLElement;
    expect(swatch.className).toBe('pool-swatch pool-swatch-color');
    expect(swatch.style.getPropertyValue('--pool-param-swatch')).toBe('var(--pool-color-ink)');
    const { container: bad } = render(<TokenSwatch name="red; color: blue" kind="color" />);
    expect((bad.firstElementChild as HTMLElement).getAttribute('style')).toBeNull();
  });
});

describe('prose', () => {
  it('renders bounded Markdown without evaluating HTML, and links only safe URLs and named sources', () => {
    const { container } = render(
      <Prose
        label="Model output"
        markdown={'# Title\n**bold** and `code` [1] [2]\n\n- one\n- two\n\n<img src=x onerror=alert(1)> [site](https://example.org) [bad](javascript:alert(1))'}
        sources={new Map([['1', 'source-1']])}
      />,
    );
    const prose = screen.getByLabelText('Model output');
    expect(prose.className).toBe('pool-prose pool-prose-blocks pool-body');
    expect(container.querySelector('img')).toBeNull();
    expect(prose.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(screen.getByRole('link', { name: '[1]' }).getAttribute('href')).toBe('#source-1');
    expect(screen.queryByRole('link', { name: '[2]' })).toBeNull();
    expect(screen.getByRole('link', { name: 'site' }).getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(container.querySelector('strong')?.textContent).toBe('bold');
  });
});

describe('navigation', () => {
  it('marks exactly one item current, nested or not', async () => {
    function Nav() {
      const [current, setCurrent] = useState('tokens');
      return (
        <SidebarLayout
          navLabel="Sections"
          nav={
            <Navigator
              current={current}
              onSelect={setCurrent}
              items={[
                { id: 'tokens', label: 'Tokens', children: [{ id: 'raw', label: 'Raw' }] },
                { id: 'primitives', label: 'Primitives' },
              ]}
            />
          }
        >
          <Text>main</Text>
        </SidebarLayout>
      );
    }
    render(<Nav />);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getAllByRole('link').filter((link) => link.getAttribute('aria-current'))).toHaveLength(1);
    await userEvent.click(screen.getByRole('link', { name: 'Raw' }));
    const current = within(nav).getAllByRole('link').filter((link) => link.getAttribute('aria-current'));
    expect(current.map((link) => link.textContent)).toEqual(['Raw']);
    expect(screen.getByRole('main').textContent).toBe('main');
  });
});

describe('dialog and sheet', () => {
  function Host({ sheet = false }) {
    const [open, setOpen] = useState(false);
    const Shell = sheet ? Sheet : Dialog;
    return (
      <>
        <Button label="Open" onPress={() => setOpen(true)} />
        <Shell
          title="Answer on"
          open={open}
          onClose={() => setOpen(false)}
          closeLabel="Close"
          footerStatus="Not on this device yet."
          footer={<Button variant="primary" label="Download" onPress={() => setOpen(false)} />}
        >
          <Text>Body</Text>
        </Shell>
      </>
    );
  }

  it('opens modally, names itself by its title and closes on Escape and Close', async () => {
    const { container } = render(<Host sheet />);
    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.className).toContain('pool-dialog-fixed');
    expect(dialog.open).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(dialog.open).toBe(true);
    expect(screen.getByText('Body')).toBeTruthy();
    expect(dialog.getAttribute('aria-labelledby')).toBe(screen.getByRole('heading', { name: 'Answer on' }).id);
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
    await vi.waitFor(() => expect(dialog.open).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(dialog.open).toBe(false);
  });

  it('puts the reason first and the actions last in the footer', async () => {
    const { container } = render(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const footer = container.querySelector('.pool-dialog-footer') as HTMLElement;
    expect(footer.firstElementChild?.textContent).toBe('Not on this device yet.');
    expect(footer.lastElementChild?.textContent).toBe('Download');
  });

  it('shows the same shell inline for a panel', () => {
    render(
      <Dialog title="Connect a desktop" open={false} onClose={() => undefined} closeLabel="Close" presentation="inline">
        <Text>Steps</Text>
      </Dialog>,
    );
    const panel = screen.getByRole('dialog', { name: 'Connect a desktop' });
    expect(panel.className).toContain('pool-dialog-inline');
    expect(screen.getByText('Steps')).toBeTruthy();
  });
});
