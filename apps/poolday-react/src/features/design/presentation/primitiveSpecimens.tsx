import { useState, type ReactNode } from 'react';
import {
  Badge,
  BarButton,
  Button,
  ConversationLayout,
  Drawer,
  MessageRow,
  MessageText,
  Menu,
  Readout,
  SelectorButton,
  StatusDot,
  ThreadItem,
  Toolbar,
  Transcript,
  Workspace,
  WorkspaceBar,
  Card,
  Chip,
  CodeBlock,
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
  Prism,
  Prose,
  Row,
  Section,
  ShareBar,
  Sheet,
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
  ICON_NAMES,
} from '@reploid/poolday-ui';

// Specimens use synthetic labels; every state a primitive has is shown side by side.

/** A confidence scale, as a study's judgment asks for it. */
function RangeSpecimen() {
  const [value, setValue] = useState(50);
  return <RangeField label="Confidence" value={value} min={0} max={100} step={10} format={(current) => `${current}%`} onChange={setValue} />;
}

function ChoiceSpecimen() {
  const [one, setOne] = useState<'device' | 'desktop' | 'contributors'>('device');
  const [mode, setMode] = useState<'active' | 'archived'>('active');
  return (
    <Columns>
      <SingleChoice
        label="Computer"
        value={one}
        onChange={setOne}
        options={[
          { value: 'device', title: 'This device', status: 'Ready' },
          { value: 'desktop', title: 'Your desktop', status: 'Offline', disabled: true, fix: { label: 'Connect', onPress: () => undefined } },
          { value: 'contributors', title: 'Contributors', status: 'Finding computers…' },
        ]}
      />
      <Stack gap="sm">
        <SingleChoice
          layout="segmented"
          label="Thread history"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'active', title: 'Active' },
            { value: 'archived', title: 'Archived' },
          ]}
        />
        <SingleChoice layout="segmented" label="Disabled" value="a" onChange={() => undefined} disabled options={[{ value: 'a', title: 'On' }, { value: 'b', title: 'Off' }]} />
      </Stack>
    </Columns>
  );
}

function MultiSpecimen() {
  const [values, setValues] = useState<Array<'files' | 'connection' | 'training'>>(['connection']);
  return (
    <MultiChoice
      label="Share"
      values={values}
      onChange={setValues}
      options={[
        { value: 'connection', title: 'Connection', status: 'Answer while this page is open' },
        { value: 'files', title: 'Model files', status: 'Others can download stored models' },
        { value: 'training', title: 'Training rounds', status: 'Needs a reviewed setup', disabled: true },
      ]}
    />
  );
}

function ToggleSpecimen() {
  const [on, setOn] = useState(true);
  return (
    <List>
      <Toggle title="Network answers" status={on ? 'On' : 'Off'} checked={on} onChange={setOn} icon="peers" />
      <Toggle title="Disabled" status="Needs a paired desktop" checked={false} onChange={() => undefined} disabled />
    </List>
  );
}

function FieldSpecimen() {
  const [name, setName] = useState('Research notes');
  const [text, setText] = useState('');
  return (
    <Columns>
      <Field label="Thread name" value={name} onChange={setName} hint="Up to 256 characters." />
      <Field label="Invite link" value="not-a-link" onChange={() => undefined} error="Paste the whole link." />
      <TextArea label="Notes" value={text} onChange={setText} placeholder="Message…" />
      <Field label="Disabled" value="Locked" onChange={() => undefined} disabled />
    </Columns>
  );
}

function InputGroupSpecimen() {
  const [text, setText] = useState('');
  return (
    <Columns>
      <InputGroup>
        <TextArea bare rows={1} label="Message" labelHidden value={text} onChange={setText} placeholder="Idle" />
        <Row gap="xs">
          <IconButton label="Attach text files" icon="attach" onPress={() => undefined} />
          <Grow />
          <IconButton variant="primary" label="Send" icon="send" onPress={() => undefined} />
        </Row>
      </InputGroup>
      <InputGroup activity="executing">
        <TextArea bare rows={1} label="Message" labelHidden value="" onChange={() => undefined} placeholder="Executing" />
        <Row gap="xs">
          <Grow />
          <IconButton variant="primary" label="Stop" icon="stop" onPress={() => undefined} />
        </Row>
      </InputGroup>
    </Columns>
  );
}

function NavigatorSpecimen() {
  const [current, setCurrent] = useState('threads');
  return (
    <Navigator
      current={current}
      onSelect={setCurrent}
      items={[
        { id: 'threads', label: 'Threads' },
        { id: 'computers', label: 'Computers', children: [{ id: 'this-device', label: 'This device' }] },
        { id: 'settings', label: 'Settings' },
      ]}
    />
  );
}

function DialogSpecimen({ sheet }: { readonly sheet: boolean }) {
  const [open, setOpen] = useState(false);
  const Shell = sheet ? Sheet : Dialog;
  const body = (
    <Text variant="small">{sheet ? 'Rows arriving while it is open never move the footer.' : 'Archive this thread? Its history stays readable.'}</Text>
  );
  const footer = (
    <>
      <Button variant="quiet" label="Cancel" onPress={() => setOpen(false)} />
      <Button variant="primary" label={sheet ? 'Use this device' : 'Archive'} onPress={() => setOpen(false)} />
    </>
  );
  return (
    <Stack gap="md">
      <Shell title={sheet ? 'Answer on' : 'Archive thread'} open={false} onClose={() => undefined} closeLabel="Close" presentation="inline" footer={footer} footerStatus={sheet ? 'Not on this device yet.' : undefined}>
        {body}
      </Shell>
      <Row>
        <Button label={sheet ? 'Open the sheet' : 'Open the dialog'} hasPopup="dialog" onPress={() => setOpen(true)} />
      </Row>
      <Shell title={sheet ? 'Answer on' : 'Archive thread'} open={open} onClose={() => setOpen(false)} closeLabel="Close" footer={footer}>
        {body}
      </Shell>
    </Stack>
  );
}

function DrawerSpecimen() {
  const [open, setOpen] = useState(true);
  return (
    <Stack gap="md">
      <Row>
        <Button label={open ? 'Drawer open' : 'Open the drawer'} pressed={open} onPress={() => setOpen(true)} />
      </Row>
      <Drawer side="end" title="Computers" open={open} onClose={() => setOpen(false)} closeLabel="Close">
        <Text variant="small">Escape or Close returns focus to what opened it.</Text>
      </Drawer>
    </Stack>
  );
}

function WorkspaceSpecimen() {
  const [threads, setThreads] = useState(false);
  return (
    <Workspace
      bar={
        <WorkspaceBar label="Workspace destinations" lead={<BarButton icon="threads" label="Threads" href="#threads" current={threads} onPress={() => setThreads(!threads)} />}>
          <BarButton icon="activity" label="Details" href="#details" onPress={() => undefined} />
          <BarButton icon="peers" label="Computers" href="#computers" onPress={() => undefined} />
          <BarButton icon="settings" label="Settings" href="#settings" onPress={() => undefined} />
        </WorkspaceBar>
      }
      start={
        <Drawer side="start" title="Threads" open={threads} onClose={() => setThreads(false)} closeLabel="Close">
          <Text variant="small">The conversation keeps its place while a drawer is open.</Text>
        </Drawer>
      }
    >
      <ConversationLayout transcript={<Transcript label="Messages" conversation={null}>{null}</Transcript>} composer={<Text variant="small" muted>The composer sits here.</Text>} />
    </Workspace>
  );
}

const SPECIMENS: Record<string, () => ReactNode> = {
  StatusDot: () => (
    <Row gap="md">
      <Row gap="xs"><StatusDot state="ready" /><Text as="span" variant="small">Ready</Text></Row>
      <Row gap="xs"><StatusDot state="waiting" /><Text as="span" variant="small">Finding computers</Text></Row>
      <Row gap="xs"><StatusDot state="unavailable" /><Text as="span" variant="small">Unavailable</Text></Row>
    </Row>
  ),
  Readout: () => (
    <Readout
      items={[
        { icon: 'privacy', text: 'Readable by This device', title: 'Readable by This device. Checked here: content stayed on this device.' },
        { icon: 'activity', text: '41.2 tok/s', title: 'Generation average including prompt processing; excludes queue and model loading' },
        { icon: 'tokens', text: '128 tokens', title: '128 generated tokens' },
        { icon: 'clock', text: '3.1 s', title: 'Generation time including prompt processing' },
      ]}
    />
  ),
  Toolbar: () => (
    <Toolbar label="Composer controls">
      <IconButton label="Attach text files" icon="attach" onPress={() => undefined} />
      <Button variant="quiet" icon="privacy" label="Your devices" onPress={() => undefined} />
      <IconButton variant="primary" label="Send" icon="send" onPress={() => undefined} />
    </Toolbar>
  ),
  SelectorButton: () => (
    <Stack gap="sm">
      <SelectorButton label="Answer on This device · Qwen 3.5 2B, Ready" status="ready" parts={[{ text: 'This device' }, { text: 'Qwen 3.5 2B' }]} onPress={() => undefined} />
      <SelectorButton label="Answer on, Finding computers" status="waiting" parts={[{ text: 'Finding computers…' }]} onPress={() => undefined} />
    </Stack>
  ),
  Menu: () => (
    <Row>
      <Menu label="Actions for Ocean tides" items={[{ label: 'Rename', onPress: () => undefined }, { label: 'Archive', onPress: () => undefined }]} />
    </Row>
  ),
  MessageText: () => <MessageText label="Your message">Explain ocean tides in two sentences.</MessageText>,
  MessageRow: () => (
    <Stack gap="lg">
      <MessageRow role="user">
        <MessageText label="Your message">Explain ocean tides in two sentences.</MessageText>
      </MessageRow>
      <MessageRow role="assistant" footer={<Text as="span" variant="caption">This device · 3.1 s</Text>}>
        <Prose markdown="The Moon's gravity pulls the oceans into a bulge, and the Earth turns beneath it." />
      </MessageRow>
      <MessageRow role="assistant" author="Thinking…" />
    </Stack>
  ),
  Transcript: () => (
    <Transcript label="Messages" conversation="specimen">
      <MessageRow role="user">
        <MessageText label="Your message">What makes a good night sky for stargazing?</MessageText>
      </MessageRow>
      <MessageRow role="assistant">
        <Prose markdown="Dark, dry and steady air, far from city lights, with the Moon below the horizon." />
      </MessageRow>
    </Transcript>
  ),
  ConversationLayout: () => (
    <ConversationLayout
      transcript={
        <Transcript label="Messages" conversation="layout">
          <MessageRow role="assistant">
            <Prose markdown="The transcript fills the column and scrolls." />
          </MessageRow>
        </Transcript>
      }
      notices={<Notice>Notices sit under the transcript.</Notice>}
      composer={<InputGroup><Text variant="small" muted>The composer stays at the bottom.</Text></InputGroup>}
    />
  ),
  ThreadItem: () => (
    <Stack gap="sm">
      <ThreadItem title="Ocean tides" digest="Complete" monogram="O" time="2m" current label="Ocean tides: Complete" onPress={() => undefined} menu={<Menu label="Actions for Ocean tides" items={[{ label: 'Rename', onPress: () => undefined }]} />} />
      <ThreadItem title="Night sky" digest="Generating" monogram="N" time="now" mark="working" activity="executing" label="Night sky: Generating" onPress={() => undefined} />
      <ThreadItem title="Trip plan" digest="New answer" monogram="T" time="1h" mark="unread" label="Trip plan: New answer" onPress={() => undefined} />
      <ThreadItem title="Recipe" digest="Interrupted" monogram="R" time="1d" mark="attention" label="Recipe: Interrupted" onPress={() => undefined} />
    </Stack>
  ),
  BarButton: () => (
    <Row>
      <BarButton icon="threads" label="Threads" href="#threads" current onPress={() => undefined} />
      <BarButton icon="peers" label="Computers" href="#computers" onPress={() => undefined} />
    </Row>
  ),
  WorkspaceBar: () => (
    <WorkspaceBar label="Workspace destinations" lead={<BarButton icon="threads" label="Threads" href="#threads" onPress={() => undefined} />}>
      <BarButton icon="activity" label="Details" href="#details" onPress={() => undefined} />
      <BarButton icon="settings" label="Settings" href="#settings" onPress={() => undefined} />
    </WorkspaceBar>
  ),
  Drawer: () => <DrawerSpecimen />,
  Workspace: () => <WorkspaceSpecimen />,
  PooldayRoot: () => (
    <Columns>
      <PooldayRoot theme="dark">
        <Surface variant="card">
          <Text>Dark</Text>
        </Surface>
      </PooldayRoot>
      <PooldayRoot theme="light">
        <Surface variant="card">
          <Text>Light</Text>
        </Surface>
      </PooldayRoot>
    </Columns>
  ),
  Text: () => (
    <Stack gap="sm">
      <Text variant="title">Title</Text>
      <Text variant="heading">Heading</Text>
      <Text variant="subheading">Subheading</Text>
      <Text>Body text reads at the base size with a reading line height.</Text>
      <Text variant="small">Small</Text>
      <Text variant="caption" muted>
        Caption, muted
      </Text>
      <Text variant="label">Label</Text>
      <Text variant="small" mono>
        sha256:9f2c…41ab
      </Text>
    </Stack>
  ),
  Prose: () => (
    <Prose
      markdown={'WebGPU gives the page **direct access** to the GPU, so a model runs where the page runs [1].\n\n- No server\n- `navigator.gpu` for compute\n\n```\nconst adapter = await navigator.gpu.requestAdapter();\n```'}
      sources={new Map([['1', 'primitive-Prose']])}
    />
  ),
  Wordmark: () => <Wordmark />,
  Prism: () => <Prism />,
  VisuallyHidden: () => (
    <Text variant="small">
      Visible text<VisuallyHidden>, with words only a screen reader hears</VisuallyHidden>
    </Text>
  ),
  Facts: () => <Facts items={[['Answered on', 'This device'], ['Model', 'Qwen 3.5 2B'], ['Time', '1.4 s']]} />,
  Stats: () => <Stats label="Recorded output tokens" items={[['Tokens supplied', '12,480'], ['Tokens consumed', '3,072']]} />,
  Icon: () => (
    <Row gap="md">
      {ICON_NAMES.map((name) => (
        <Icon key={name} name={name} />
      ))}
    </Row>
  ),
  Badge: () => (
    <Row>
      <Badge>Neutral</Badge>
      <Badge tone="ready">Ready</Badge>
      <Badge tone="pending">Pending</Badge>
      <Badge tone="unavailable">Offline</Badge>
      <Badge tone="error">Failed</Badge>
    </Row>
  ),
  StatusLine: () => (
    <Stack gap="xs">
      <StatusLine>Finding computers…</StatusLine>
      <StatusLine />
      <Text variant="caption" muted>
        The empty line above keeps its height.
      </Text>
    </Stack>
  ),
  Spinner: () => <Spinner label="Loading" />,
  Progress: () => (
    <Stack gap="sm">
      <Progress label="Download" value={0.4} />
      <Progress label="Preparing" />
    </Stack>
  ),
  Divider: () => (
    <Stack gap="sm">
      <Text variant="small">Above</Text>
      <Divider />
      <Text variant="small">Below</Text>
    </Stack>
  ),
  Stack: () => (
    <Row gap="lg">
      {(['xs', 'sm', 'md', 'lg'] as const).map((gap) => (
        <Stack key={gap} gap={gap}>
          <Badge>{gap}</Badge>
          <Badge>{gap}</Badge>
        </Stack>
      ))}
    </Row>
  ),
  Row: () => (
    <Stack gap="sm">
      <Row justify="start">
        <Badge>Start</Badge>
        <Badge>Start</Badge>
      </Row>
      <Row justify="between">
        <Badge>Between</Badge>
        <Badge>Between</Badge>
      </Row>
      <Row justify="end">
        <Badge>End</Badge>
      </Row>
    </Stack>
  ),
  Columns: () => (
    <Columns>
      <Surface variant="well">
        <Text variant="small">One</Text>
      </Surface>
      <Surface variant="well">
        <Text variant="small">Two</Text>
      </Surface>
      <Surface variant="well">
        <Text variant="small">Three</Text>
      </Surface>
    </Columns>
  ),
  Grow: () => (
    <Row>
      <Badge>Fixed</Badge>
      <Grow>
        <Surface variant="well">
          <Text variant="small">Grows</Text>
        </Surface>
      </Grow>
      <Badge>Fixed</Badge>
    </Row>
  ),
  Log: () => (
    <Log label="Messages">
      <Text variant="small">First message</Text>
      <Text variant="small">Second message</Text>
    </Log>
  ),
  Surface: () => (
    <Columns>
      <Surface variant="raised">
        <Text variant="small">Raised</Text>
      </Surface>
      <Surface variant="card">
        <Text variant="small">Card</Text>
      </Surface>
      <Surface variant="well">
        <Text variant="small">Well</Text>
      </Surface>
    </Columns>
  ),
  Card: () => (
    <Card title="Your desktop" status="Ready · Qwen 3.5 27B" actions={<Button variant="quiet" label="Disconnect" onPress={() => undefined} />}>
      <Text variant="small">Answers only you while it is online.</Text>
    </Card>
  ),
  Frame: () => (
    <Frame width="narrow" label="Narrow frame">
      <Text variant="small">Phone width</Text>
    </Frame>
  ),
  Button: () => (
    <Stack gap="sm">
      <Row>
        <Button variant="primary" label="Primary" onPress={() => undefined} />
        <Button label="Secondary" onPress={() => undefined} />
        <Button variant="quiet" label="Quiet" onPress={() => undefined} />
        <Button variant="quiet" icon="plus" label="With icon" onPress={() => undefined} />
      </Row>
      <Row>
        <Button variant="primary" label="Disabled" />
        <Button label="Saving" pending pendingLabel="Saving…" onPress={() => undefined} />
        <Button variant="quiet" label="Pressed" pressed onPress={() => undefined} />
        <Button variant="quiet" label="Destination" href="#primitive-Button" />
      </Row>
    </Stack>
  ),
  IconButton: () => (
    <Row>
      <IconButton label="Close" icon="close" onPress={() => undefined} />
      <IconButton variant="secondary" label="Copy" icon="copy" onPress={() => undefined} />
      <IconButton variant="primary" label="Send" icon="send" onPress={() => undefined} />
      <IconButton variant="primary" label="Send (disabled)" icon="send" />
    </Row>
  ),
  Chip: () => (
    <Row>
      <Chip label="Explain WebGPU in two sentences" onPress={() => undefined} />
    </Row>
  ),
  Field: () => <FieldSpecimen />,
  TextArea: () => <FieldSpecimen />,
  InputGroup: () => <InputGroupSpecimen />,
  Toggle: () => <ToggleSpecimen />,
  SingleChoice: () => <ChoiceSpecimen />,
  MultiChoice: () => <MultiSpecimen />,
  ListItem: () => (
    <List>
      <ListItem icon="device" title="Action" status="Runs a command" onPress={() => undefined} />
      <ListItem icon="settings" title="Destination" status="Opens another screen" href="#primitive-ListItem" />
      <ListItem icon="threads" title="Current" status="The one selected row" current onPress={() => undefined} />
      <ListItem icon="model" title="Static" status="Shows a fact" trailing={<Badge tone="ready">Ready</Badge>} />
      <ListItem icon="clock" title="Disabled" status="Waiting for a paired desktop" disabled onPress={() => undefined} />
    </List>
  ),
  List: () => (
    <List>
      <ListItem title="First" status="Rows share one grid" />
      <ListItem title="Second" status="" />
    </List>
  ),
  Section: () => (
    <Section title="Computer" note="The answering computer can read your prompt.">
      <List>
        <ListItem title="This device" status="Ready" />
      </List>
    </Section>
  ),
  Disclosure: () => (
    <Stack gap="sm">
      <Disclosure summary="Model details">
        <Text variant="small" muted>
          2.1 GB · Q4K · 32K context
        </Text>
      </Disclosure>
      <List>
        <Disclosure quiet summary="Receipt" status="This device · 1.4 s">
          <Facts items={[['Answered on', 'This device']]} />
        </Disclosure>
      </List>
    </Stack>
  ),
  Notice: () => (
    <Stack gap="sm">
      <Notice>Reset to this device. Send a new message to use updated settings.</Notice>
      <Notice tone="pending">Finding computers…</Notice>
      <Notice tone="error" action={<Button variant="quiet" label="Retry" onPress={() => undefined} />}>
        The contributor disconnected before answering.
      </Notice>
    </Stack>
  ),
  Navigator: () => <NavigatorSpecimen />,
  SidebarLayout: () => (
    <Text variant="small" muted>
      This page is a SidebarLayout: the navigator on the left, or the bar above on narrow screens.
    </Text>
  ),
  Dialog: () => <DialogSpecimen sheet={false} />,
  Sheet: () => <DialogSpecimen sheet />,
  CodeBlock: () => <CodeBlock>{'{\n  "kind": "permission",\n  "recipient": "peer:a1b2"\n}'}</CodeBlock>,
  ShareBar: () => <ShareBar label="Recorded step time share: This device 62%, Desktop 38%" shares={[0.62, 0.38]} />,
  DataTable: () => (
    <DataTable
      label="Study results"
      columns={['Task', 'Condition', 'Your choice', 'Actual']}
      rows={[
        ['Arithmetic', 'imitation', 'A', 'A'],
        ['Summary', 'same-model', 'same', 'same'],
      ]}
    />
  ),
  RangeField: () => <RangeSpecimen />,
  FilePicker: () => (
    <FilePicker label="Data export file" accept=".json" onFiles={() => undefined}>
      {(open) => <Button icon="upload" label="Import data" onPress={open} />}
    </FilePicker>
  ),
  DetailSheet: () => (
    <List>
      <DetailSheet title="Manual pairing" status="Enter host ID and code" closeLabel="Close">
        <Stack gap="sm">
          <Field label="Host ID" value="" onChange={() => undefined} placeholder="peer:…" />
          <Field label="Code" value="" onChange={() => undefined} />
        </Stack>
      </DetailSheet>
    </List>
  ),
  EmptyState: () => (
    <EmptyState
      title="No guest invites yet"
      description="Create a bounded link so someone else can ask your computers a few questions."
      action={<Button variant="primary" label="Create link" onPress={() => undefined} />}
    />
  ),
  TokenSwatch: () => (
    <Row gap="md">
      <TokenSwatch name="--pool-color-ink" kind="color" />
      <TokenSwatch name="--pool-surface-primary" kind="image" />
      <TokenSwatch name="--pool-shadow-raised" kind="shadow" />
      <TokenSwatch name="--pool-radius-panel" kind="radius" />
      <TokenSwatch name="--pool-text-lg" kind="text" />
    </Row>
  ),
};

/** The live specimen of one primitive, or null for a component this page does not know yet. */
export function PrimitiveSpecimen({ name }: { readonly name: string }) {
  const render = SPECIMENS[name];
  return render ? <>{render()}</> : null;
}
