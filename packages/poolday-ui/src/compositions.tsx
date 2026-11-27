import { useState, type ReactNode } from 'react';
import { StatusDot } from './conversation.js';
import { Sheet } from './dialog.js';
import { Notice, type Tone } from './feedback.js';
import { Icon, type IconName } from './icon.js';
import { dataProps, type DataAttributes } from './internal.js';
import { ListItem, RowText } from './rows.js';
import { Text } from './text.js';

/**
 * Standard panel header: title, optional one-line summary, and at most one primary or quiet action.
 * Replaces ad-hoc heading + caption stacks at the top of drawers, cards, and sections.
 */
export function PanelHeader({
  title,
  summary,
  action,
  as = 'h3',
  data,
}: {
  readonly title: string;
  readonly summary?: ReactNode;
  readonly action?: ReactNode;
  readonly as?: 'h2' | 'h3';
  readonly data?: DataAttributes;
}) {
  return (
    <header className="pool-panel-header" {...dataProps(data)}>
      <div className="pool-stack pool-gap-xs pool-grow">
        <Text as={as} variant="heading">
          {title}
        </Text>
        {summary !== undefined && summary !== null && summary !== '' && (
          <Text variant="small" muted>
            {summary}
          </Text>
        )}
      </div>
      {action !== undefined && <div className="pool-panel-header-action">{action}</div>}
    </header>
  );
}

const dotStateFor = (tone: Tone): 'ready' | 'waiting' | 'unavailable' => {
  if (tone === 'ready') return 'ready';
  if (tone === 'pending') return 'waiting';
  return 'unavailable';
};

/**
 * Compact scannable status strip: one leading status with tone, plus up to a few tabular key/value
 * readouts. Keeps a panel's current state visible at a glance without a wall of prose.
 */
export function SummaryStrip({
  tone = 'neutral',
  status,
  items = [],
  data,
}: {
  readonly tone?: Tone;
  readonly status: ReactNode;
  readonly items?: ReadonlyArray<readonly [string, ReactNode]>;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-summary-strip pool-well" {...dataProps(data)}>
      <span className="pool-row pool-gap-xs">
        <StatusDot state={dotStateFor(tone)} />
        <Text as="span" variant="small">
          {status}
        </Text>
      </span>
      {items.length > 0 && (
        <dl className="pool-summary-items">
          {items.map(([label, value]) => (
            <div className="pool-summary-item" key={label}>
              <dt className="pool-caption pool-muted">{label}</dt>
              <dd className="pool-small pool-tabular">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Standard setting or action row inside a List: optional leading icon, title with one short status
 * line, and one trailing control (or chevron action when `onPress` is provided without `control`).
 */
export function ControlRow({
  title,
  status,
  icon,
  control,
  onPress,
  disabled = false,
  label,
  data,
}: {
  readonly title: ReactNode;
  readonly status?: ReactNode;
  readonly icon?: IconName;
  readonly control?: ReactNode;
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly data?: DataAttributes;
}) {
  if (onPress !== undefined && control === undefined) {
    return (
      <ListItem
        title={title}
        status={status}
        icon={icon}
        onPress={onPress}
        disabled={disabled}
        label={label}
        trailing={<Icon name="next" size="sm" />}
        data={data}
      />
    );
  }
  return (
    <div className="pool-control-row" {...dataProps(data)}>
      {icon !== undefined && <Icon name={icon} />}
      <RowText title={title} status={status} />
      {control !== undefined && <span className="pool-control-slot">{control}</span>}
    </div>
  );
}

/**
 * Progressive disclosure into a bounded Sheet instead of nesting Disclosure inside Disclosure.
 * Renders a ListItem row with a chevron that opens the Sheet; supports controlled or uncontrolled state.
 */
export function DetailSheet({
  title,
  status,
  icon,
  sheetTitle,
  closeLabel,
  open,
  onOpenChange,
  footer,
  footerStatus,
  wide = false,
  tall = false,
  presentation = 'modal',
  children,
  data,
  sheetData,
}: {
  readonly title: string;
  readonly status?: ReactNode;
  readonly icon?: IconName;
  readonly sheetTitle?: string;
  readonly closeLabel: string;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly footer?: ReactNode;
  readonly footerStatus?: ReactNode;
  readonly wide?: boolean;
  readonly tall?: boolean;
  readonly presentation?: 'modal' | 'inline';
  readonly children: ReactNode;
  readonly data?: DataAttributes;
  readonly sheetData?: DataAttributes;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  return (
    <>
      <ListItem
        title={title}
        status={status}
        icon={icon}
        onPress={() => setOpen(true)}
        trailing={<Icon name="next" size="sm" />}
        data={data}
      />
      <Sheet
        title={sheetTitle ?? title}
        open={isOpen}
        onClose={() => setOpen(false)}
        closeLabel={closeLabel}
        footer={footer}
        footerStatus={footerStatus}
        wide={wide}
        tall={tall}
        presentation={presentation}
        data={sheetData}
      >
        {children}
      </Sheet>
    </>
  );
}

/**
 * Unified inline banner for errors, warnings, and status notices. Renders nothing when empty while
 * keeping its live region mounted so screen readers announce the first message without layout shift.
 */
export function InlineAlert({
  tone = 'neutral',
  children,
  action,
  data,
}: {
  readonly tone?: Tone;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <Notice tone={tone} action={action} data={data}>
      {children}
    </Notice>
  );
}

/**
 * Compact empty state: one clear title, an optional one-line explanation, and at most one primary action.
 */
export function EmptyState({
  title,
  description,
  action,
  data,
}: {
  readonly title: string;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly data?: DataAttributes;
}) {
  return (
    <div className="pool-empty-state pool-well" {...dataProps(data)}>
      <Text variant="small">{title}</Text>
      {description !== undefined && description !== null && description !== '' && (
        <Text variant="caption" muted>
          {description}
        </Text>
      )}
      {action !== undefined && <div className="pool-empty-state-action">{action}</div>}
    </div>
  );
}
