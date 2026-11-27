// Interaction and accessibility of each @reploid/poolday-ui primitive: roles, names, keyboard
// operation, disabled and selected states, and the primitive classes each one renders.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  BarButton,
  Button,
  ConversationLayout,
  Drawer,
  Menu,
  MessageRow,
  MessageText,
  Readout,
  SelectorButton,
  StatusDot,
  ThreadItem,
  Toolbar,
  Transcript,
  Workspace,
  WorkspaceBar,
  Card,
  CodeBlock,
  Prism,
  Chip,
  Columns,
  Dialog,
  Disclosure,
  Divider,
  Facts,
  Stats,
  Field,
  FilePicker,
  DataTable,
  RangeField,
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
  ShareBar,
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
  DetailSheet,
  EmptyState,
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

  it('wraps a long value anywhere on request and spaces a list of controls by a token gap', () => {
    render(
      <PooldayRoot>
        <Text variant="caption" wrapAnywhere>
          https://example.test/a-very-long-link
        </Text>
        <List data={{ 'data-plain': true }}>
          <Text>One</Text>
        </List>
        <List gap="sm" data={{ 'data-spaced': true }}>
          <Text>Two</Text>
        </List>
      </PooldayRoot>,
    );
    expect(screen.getByText('https://example.test/a-very-long-link').className).toBe('pool-caption pool-break');
    expect(document.querySelector('[data-plain]')?.className).toBe('pool-group');
    expect(document.querySelector('[data-spaced]')?.className).toBe('pool-group pool-gap-sm');
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

describe('stats', () => {
  it('names a group of measured values and pairs each caption with its value', () => {
    const { container } = render(<Stats label="Recorded output tokens" items={[['Tokens supplied', '12'], ['Tokens consumed', '3']]} data={{ 'data-usage': true }} />);
    const group = container.querySelector('dl');
    expect(group?.getAttribute('aria-label')).toBe('Recorded output tokens');
    expect(group?.classList.contains('pool-stats')).toBe(true);
    expect(group?.getAttribute('data-usage')).toBe('');
    expect([...container.querySelectorAll('dt')].map((node) => node.textContent)).toEqual(['Tokens supplied', 'Tokens consumed']);
    expect(screen.getByText('12').tagName).toBe('DD');
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

  it('a tall sheet takes the taller fixed height; a dialog ignores it', () => {
    const { container } = render(
      <PooldayRoot>
        <Sheet title="Long" open={false} tall onClose={() => {}} closeLabel="Close" presentation="inline" data={{ 'data-tall-sheet': true }}>
          <Text>Rows</Text>
        </Sheet>
        <Dialog title="Short" open={false} tall onClose={() => {}} closeLabel="Close" presentation="inline" data={{ 'data-tall-dialog': true }}>
          <Text>Body</Text>
        </Dialog>
      </PooldayRoot>,
    );
    expect(container.querySelector('[data-tall-sheet]')?.className).toContain('pool-dialog-fixed pool-dialog-tall');
    expect(container.querySelector('[data-tall-dialog]')?.className).not.toContain('pool-dialog-tall');
  });

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

describe('records', () => {
  it('shows a record verbatim on an inset well', () => {
    const { container } = render(<CodeBlock label="Permission record">{'{\n  "id": 1\n}'}</CodeBlock>);
    const block = container.querySelector('pre') as HTMLElement;
    expect(block.className).toBe('pool-well pool-caption pool-mono');
    expect(block.textContent).toBe('{\n  "id": 1\n}');
    expect(block.getAttribute('aria-label')).toBe('Permission record');
  });

  it('states every share in words and sets only the share parameter', () => {
    render(<ShareBar label="Recorded step time share: A 75%, B 25%" shares={[0.75, 0.25]} />);
    const bar = screen.getByRole('img', { name: 'Recorded step time share: A 75%, B 25%' });
    expect(bar.className).toBe('pool-bar');
    expect([...bar.children].map((span) => (span as HTMLElement).style.getPropertyValue('--pool-param-share'))).toEqual(['0.75', '0.25']);
  });

  it('opens the chooser from its control and reports the chosen files once', async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <FilePicker label="Data export file" accept=".json" onFiles={onFiles} data={{ 'data-file': true }}>
        {(open) => <Button label="Import data" onPress={open} />}
      </FilePicker>,
    );
    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    expect(input.hidden).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Data export file');
    expect(input.hasAttribute('data-file')).toBe(true);
    const click = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: 'Import data' }));
    expect(click).toHaveBeenCalledTimes(1);
    const file = new File(['{}'], 'export.json', { type: 'application/json' });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
  });

  it('labels a data table with column headers and, when asked, row headers', () => {
    render(<DataTable label="Study results" columns={['Task', 'Actual']} rows={[['Arithmetic', 'A']]} rowHeaders data={{ 'data-results': true }} />);
    const table = screen.getByRole('table', { name: 'Study results' });
    expect(table.parentElement?.className).toBe('pool-table');
    expect(table.parentElement?.hasAttribute('data-results')).toBe(true);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Task', 'Actual']);
    expect(screen.getByRole('rowheader').textContent).toBe('Arithmetic');
    expect(screen.getByRole('cell').textContent).toBe('A');
  });

  it('reports a range value as a number and writes it in the caller\'s words', () => {
    const onChange = vi.fn();
    render(<RangeField label="Confidence" value={50} step={10} format={(value) => `${value}%`} onChange={onChange} data={{ 'data-confidence': true }} />);
    const slider = screen.getByRole('slider', { name: 'Confidence' }) as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('50%');
    expect(slider.hasAttribute('data-confidence')).toBe(true);
    expect(screen.getByText('50%').tagName).toBe('OUTPUT');
    fireEvent.change(slider, { target: { value: '70' } });
    expect(onChange).toHaveBeenCalledWith(70);
  });
});

describe('workspace', () => {
  function Frame({ onClose }: { readonly onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <Workspace
        bar={
          <WorkspaceBar label="Workspace destinations" lead={<BarButton icon="threads" label="Threads" href="?view=threads" current={open} controls="threads" onPress={() => setOpen(!open)} />}>
            <BarButton icon="settings" label="Settings" href="?view=settings" onPress={() => undefined} />
          </WorkspaceBar>
        }
        start={
          <Drawer id="threads" side="start" title="Threads" open={open} onClose={() => { setOpen(false); onClose?.(); }} closeLabel="Close">
            <Button label="New thread" onPress={() => undefined} />
          </Drawer>
        }
      >
        <Text>Conversation</Text>
      </Workspace>
    );
  }

  it('names its bar, links each destination and reports the current one', () => {
    render(<Frame />);
    const nav = screen.getByRole('navigation', { name: 'Workspace destinations' });
    expect(nav.className).toBe('pool-workspace-bar pool-surface');
    const threads = within(nav).getByRole('link', { name: 'Threads' });
    expect(threads.getAttribute('href')).toBe('?view=threads');
    expect(threads.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('main').className).toBe('pool-workspace-main');
  });

  it('opens a drawer on a plain click, focuses its heading, and returns focus to its opener when closed', async () => {
    const onClose = vi.fn();
    render(<Frame onClose={onClose} />);
    const threads = screen.getByRole('link', { name: 'Threads' });
    await userEvent.click(threads);
    expect(threads.getAttribute('aria-current')).toBe('page');
    const drawer = document.getElementById('threads') as HTMLElement;
    expect(drawer.hidden).toBe(false);
    expect(document.activeElement).toBe(within(drawer).getByRole('heading', { name: 'Threads' }));
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
    expect(drawer.hidden).toBe(true);
    expect(document.activeElement).toBe(threads);
  });

  it('makes the main column inert while an open drawer covers it, and closes that drawer on Escape from the bar', async () => {
    // jsdom has no layout: lay the drawer over the whole main column, as a phone does.
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = this.classList.contains('pool-drawer') ? { left: 8, right: 382 } : this.classList.contains('pool-workspace-main') ? { left: 8, right: 382 } : { left: 0, right: 0 };
      return { ...box, top: 0, bottom: 10, width: box.right - box.left, height: 10, x: box.left, y: 0, toJSON: () => box } as DOMRect;
    });
    try {
      const onClose = vi.fn();
      render(<Frame onClose={onClose} />);
      const threads = screen.getByRole('link', { name: 'Threads' });
      const main = document.querySelector('.pool-workspace-main') as HTMLElement;
      expect(main.hasAttribute('inert')).toBe(false);
      await userEvent.click(threads);
      expect(main.hasAttribute('inert')).toBe(true);
      expect(main.hasAttribute('data-covered')).toBe(true);
      threads.focus();
      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledOnce();
      expect(main.hasAttribute('inert')).toBe(false);
    } finally {
      rect.mockRestore();
    }
  });

  it('keeps a drawer that lies beside the main column open when Escape is pressed outside it', async () => {
    const onClose = vi.fn();
    render(<Frame onClose={onClose} />);
    const threads = screen.getByRole('link', { name: 'Threads' });
    await userEvent.click(threads);
    expect((document.querySelector('.pool-workspace-main') as HTMLElement).hasAttribute('inert')).toBe(false);
    threads.focus();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves a modified click to the browser, as a link does', () => {
    const onPress = vi.fn();
    render(<BarButton icon="peers" label="Computers" href="?view=computers" onPress={onPress} />);
    const link = screen.getByRole('link', { name: 'Computers' });
    const modified = fireEvent.click(link, { metaKey: true });
    expect(modified).toBe(true);
    expect(onPress).not.toHaveBeenCalled();
    expect(fireEvent.click(link)).toBe(false);
    expect(onPress).toHaveBeenCalledOnce();
  });
});

describe('conversation', () => {
  it('keeps a reader at the bottom as output arrives, and lays the column out once', () => {
    const { container, rerender } = render(
      <ConversationLayout
        transcript={<Transcript label="Messages" conversation="a"><MessageRow role="user"><MessageText label="Your message">Hello</MessageText></MessageRow></Transcript>}
        composer={<Text>Composer</Text>}
      />,
    );
    const log = screen.getByRole('log', { name: 'Messages' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    const scroller = log.parentElement as HTMLElement;
    expect(scroller.className).toBe('pool-transcript');
    expect(container.querySelector('.pool-conversation-composer')?.textContent).toBe('Composer');
    rerender(
      <ConversationLayout
        transcript={<Transcript label="Messages" conversation="b"><MessageRow role="assistant" author="Thinking…" /></Transcript>}
        composer={<Text>Composer</Text>}
      />,
    );
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(container.querySelector('article')?.className).toBe('pool-message pool-message-assistant');
  });

  it('places the person\'s words on a bubble and an answer across the column', () => {
    const { container } = render(
      <>
        <MessageRow role="user" footer={<Text as="span">footer</Text>}><MessageText label="Your message">Hi</MessageText></MessageRow>
        <MessageRow role="assistant"><Text>Answer</Text></MessageRow>
      </>,
    );
    const [user, answer] = [...container.querySelectorAll('article')];
    expect(user?.className).toBe('pool-message pool-message-user pool-reveal-host');
    expect(answer?.className).toBe('pool-message pool-message-assistant');
    expect(screen.getByLabelText('Your message').className).toBe('pool-message-text pool-well pool-body');
  });

  it('names a selector by its choice and availability, and hides its parts\' separators', async () => {
    const onPress = vi.fn();
    render(<SelectorButton label="Answer on This device · Qwen, Ready" status="ready" parts={[{ text: 'This device', data: { 'data-source': true } }, { text: 'Qwen' }]} onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Answer on This device · Qwen, Ready' });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.querySelector('[data-availability]')?.getAttribute('data-availability')).toBe('ready');
    expect(button.querySelector('[data-source]')?.textContent).toBe('This device');
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('marks availability with a dot: filled, pulsing or hollow', () => {
    const { container } = render(<><StatusDot state="ready" /><StatusDot state="waiting" /><StatusDot state="unavailable" /></>);
    expect([...container.querySelectorAll('span')].map((dot) => dot.className)).toEqual(['pool-dot', 'pool-dot pool-dot-pulse', 'pool-dot pool-dot-open']);
  });

  it('reads each measurement on focus and drops unrecorded ones', () => {
    render(<Readout items={[{ icon: 'clock', text: '3.1 s', title: 'Generation time' }, { icon: 'tokens', text: '', title: null }]} />);
    const time = screen.getByLabelText('Generation time');
    expect(time.tabIndex).toBe(0);
    expect(screen.queryAllByRole('generic', { name: /tokens/ })).toHaveLength(0);
  });

  it('closes a menu after a choice and returns focus to its button', async () => {
    const rename = vi.fn();
    const { container } = render(<Menu label="Actions for Ocean tides" items={[{ label: 'Rename', onPress: rename }]} />);
    const details = container.querySelector('details') as HTMLDetailsElement;
    const summary = container.querySelector('summary') as HTMLElement;
    expect(summary.getAttribute('aria-label')).toBe('Actions for Ocean tides');
    details.open = true;
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(rename).toHaveBeenCalledOnce();
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('folds a menu away when focus leaves it, without pulling focus back', async () => {
    const { container } = render(<><Menu label="Actions for Ocean tides" items={[{ label: 'Rename', onPress: () => undefined }]} /><Button label="Elsewhere" onPress={() => undefined} /></>);
    const details = container.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    screen.getByRole('button', { name: 'Rename' }).focus();
    await userEvent.tab();
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it('marks exactly the current thread, names it with its state, and keeps its menu beside it', async () => {
    const onPress = vi.fn();
    render(
      <>
        <ThreadItem title="Tides" digest="Complete" monogram="T" time="2m" current label="Tides: Complete" onPress={onPress} menu={<Menu label="Actions for Tides" items={[]} />} />
        <ThreadItem title="Sky" digest="Generating" monogram="S" time="now" mark="working" activity="executing" label="Sky: Generating" onPress={() => undefined} />
      </>,
    );
    const tides = screen.getByRole('button', { name: 'Tides: Complete' });
    expect(tides.getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Sky: Generating' }).getAttribute('aria-current')).toBe('false');
    expect(screen.getByRole('button', { name: 'Sky: Generating' }).getAttribute('data-activity')).toBe('executing');
    await userEvent.click(tides);
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('keeps a toolbar\'s controls in one named row', () => {
    render(<Toolbar label="Composer controls"><Button label="Attach" onPress={() => undefined} /><Button label="Send" onPress={() => undefined} /></Toolbar>);
    const bar = screen.getByRole('toolbar', { name: 'Composer controls' });
    expect(bar.className).toBe('pool-toolbar');
    expect(within(bar).getAllByRole('button')).toHaveLength(2);
  });
});

describe('grouped choices', () => {
  it('groups options in one radio group, browses with arrows, commits on Enter or a second click, and offers a deeper step', async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    const inspect = vi.fn();
    function Grouped() {
      const [value, setValue] = useState<string>('a');
      return (
        <SingleChoice
          label="Model"
          value={value}
          onChange={(next, input) => { setValue(next); onChange(next, input); }}
          onCommit={onCommit}
          groups={[
            { id: 'local', label: 'On this device', options: [{ value: 'a', title: 'Model A', status: 'On this device' }] },
            { id: 'shared', label: 'Public network', options: [{ value: 'b', title: 'Model B', status: 'Ready · 2 computers', action: { label: 'View 2 computers serving Model B', icon: 'next', onPress: inspect } }] },
            { id: 'empty', label: 'Your private computers', options: [], empty: 'No private computer is connected.' },
            { id: 'unavailable', label: 'Unavailable · 1', folded: true, options: [{ value: 'c', title: 'Model C', status: 'Unavailable', disabled: true }] },
          ]}
        />
      );
    }
    render(<Grouped />);
    const group = screen.getByRole('radiogroup', { name: 'Model' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    expect(within(group).getByRole('group', { name: 'Public network' })).toBeTruthy();
    expect(screen.getByText('No private computer is connected.')).toBeTruthy();
    const a = screen.getByRole('radio', { name: 'Model A' });
    a.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('b', { browsing: true });
    await userEvent.keyboard('{Enter}');
    expect(onCommit).toHaveBeenLastCalledWith('b');
    await userEvent.click(screen.getByRole('radio', { name: 'Model A' }));
    expect(onChange).toHaveBeenLastCalledWith('a', { browsing: false });
    await userEvent.click(screen.getByRole('radio', { name: 'Model A' }));
    expect(onCommit).toHaveBeenLastCalledWith('a');
    await userEvent.click(screen.getByRole('button', { name: 'View 2 computers serving Model B' }));
    expect(inspect).toHaveBeenCalledOnce();
  });
});

describe('decorative prism', () => {
  it('stays out of the accessibility tree, runs its enhancer on the shell and cleans it up', () => {
    const cleanupEnhancer = vi.fn();
    const enhance = vi.fn((shell: HTMLElement) => {
      shell.dataset.prismState = 'ready';
      return cleanupEnhancer;
    });
    const { container, unmount } = render(<Prism enhance={enhance} />);
    const shell = container.querySelector('.pool-prism-art') as HTMLElement;
    expect(shell.getAttribute('aria-hidden')).toBe('true');
    expect(shell.querySelector('[data-pool-prism-canvas]')).toBeTruthy();
    expect(shell.querySelector('svg.pool-prism-still')).toBeTruthy();
    expect(enhance).toHaveBeenCalledWith(shell);
    expect(shell.dataset.prismState).toBe('ready');
    unmount();
    expect(cleanupEnhancer).toHaveBeenCalledTimes(1);
  });

  it('renders the still artwork alone without an enhancer, with distinct gradient ids per prism', () => {
    const { container } = render(<><Prism /><Prism /></>);
    const ids = [...container.querySelectorAll('linearGradient')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(container.querySelectorAll('.pool-prism-art')).toHaveLength(2);
  });
});

describe('canonical compositions', () => {
  it('renders EmptyState with title, description, and action', async () => {
    const onAction = vi.fn();
    render(
      <PooldayRoot>
        <EmptyState
          title="No invites"
          description="Create a guest link."
          action={<Button label="Create" onPress={onAction} />}
          data={{ 'data-empty-state': true }}
        />
      </PooldayRoot>,
    );
    expect(screen.getByText('No invites')).toBeTruthy();
    expect(screen.getByText('Create a guest link.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('opens and closes DetailSheet in both uncontrolled and controlled modes', async () => {
    const onOpenChange = vi.fn();
    render(
      <PooldayRoot>
        <List>
          <DetailSheet title="Advanced" status="2 options" closeLabel="Close" onOpenChange={onOpenChange} data={{ 'data-detail-trigger': true }} sheetData={{ 'data-detail-sheet': true }}>
            <Text>Sheet body</Text>
          </DetailSheet>
        </List>
      </PooldayRoot>,
    );
    expect(screen.queryByText('Sheet body')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('Sheet body')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText('Sheet body')).toBeNull();
  });
});
