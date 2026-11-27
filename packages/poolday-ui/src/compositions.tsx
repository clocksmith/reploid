import { useState, type ReactNode } from 'react';
import { Sheet } from './dialog.js';
import { Icon, type IconName } from './icon.js';
import { dataProps, type DataAttributes } from './internal.js';
import { ListItem } from './rows.js';
import { Text } from './text.js';

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
