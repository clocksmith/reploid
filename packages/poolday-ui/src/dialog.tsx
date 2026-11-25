import { useEffect, useId, useRef, type ReactNode } from 'react';
import { IconButton } from './buttons.js';
import { cx, dataProps, type DataAttributes } from './internal.js';

type DialogProps = {
  readonly title: string;
  readonly open: boolean;
  /** Called for Escape, the Close button and a backdrop dismissal. The caller sets `open` false. */
  readonly onClose: () => void;
  readonly closeLabel: string;
  readonly children: ReactNode;
  /** Actions at the end of the pinned footer; the primary goes last. */
  readonly footer?: ReactNode;
  /** The reason or status at the start of the footer, for example why the primary is disabled. */
  readonly footerStatus?: ReactNode;
  readonly wide?: boolean;
  /** `inline` shows the same shell in the page flow, for a panel or a design-page specimen. */
  readonly presentation?: 'modal' | 'inline';
  readonly data?: DataAttributes;
};

function DialogShell({
  title,
  open,
  onClose,
  closeLabel,
  children,
  footer,
  footerStatus,
  wide = false,
  presentation = 'modal',
  fixed,
  data,
}: DialogProps & { readonly fixed: boolean }) {
  if (presentation === 'inline') {
    return (
      <InlineShell title={title} closeLabel={closeLabel} onClose={onClose} footer={footer} footerStatus={footerStatus} fixed={fixed} wide={wide} data={data}>
        {children}
      </InlineShell>
    );
  }
  return (
    <ModalShell title={title} open={open} onClose={onClose} closeLabel={closeLabel} footer={footer} footerStatus={footerStatus} fixed={fixed} wide={wide} data={data}>
      {children}
    </ModalShell>
  );
}

type ShellParts = {
  readonly title: string;
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer: ReactNode | undefined;
  readonly footerStatus: ReactNode | undefined;
  readonly fixed: boolean;
  readonly wide: boolean;
  readonly data: DataAttributes | undefined;
};

function ShellContent({ titleId, title, closeLabel, onClose, children, footer, footerStatus }: ShellParts & { readonly titleId: string }) {
  return (
    <>
      <header className="pool-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <IconButton label={closeLabel} icon="close" onPress={onClose} data={{ 'data-dialog-close': true }} />
      </header>
      <div className="pool-dialog-body">{children}</div>
      {(footer !== undefined || footerStatus !== undefined) && (
        <footer className="pool-dialog-footer">
          <p className="pool-status-line" role="status">
            {footerStatus}
          </p>
          {footer}
        </footer>
      )}
    </>
  );
}

const shellClass = (fixed: boolean, wide: boolean, inline: boolean) =>
  cx('pool-dialog', 'pool-surface', 'pool-small', fixed && 'pool-dialog-fixed', wide && 'pool-dialog-wide', inline && 'pool-dialog-inline');

function InlineShell(props: ShellParts) {
  const titleId = useId();
  return (
    <section className={shellClass(props.fixed, props.wide, true)} role="dialog" aria-modal="false" aria-labelledby={titleId} {...dataProps(props.data)}>
      <ShellContent {...props} titleId={titleId} />
    </section>
  );
}

function ModalShell({ open, ...props }: ShellParts & { readonly open: boolean }) {
  const { onClose, fixed, wide, data } = props;
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = dialog.ownerDocument.activeElement;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Escape fires cancel; the caller owns `open`, so report it and let the effect close.
    const cancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    const closed = () => {
      const target = opener.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    };
    dialog.addEventListener('cancel', cancel);
    dialog.addEventListener('close', closed);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.removeEventListener('close', closed);
    };
  }, []);

  return (
    <dialog ref={ref} className={shellClass(fixed, wide, false)} aria-labelledby={titleId} {...dataProps(data)}>
      <ShellContent {...props} titleId={titleId}>
        {open ? props.children : null}
      </ShellContent>
    </dialog>
  );
}

/** A bounded decision or confirmation: header, scrolling body, footer with the reason then the actions. */
export function Dialog(props: DialogProps) {
  return <DialogShell {...props} fixed={false} />;
}

/**
 * A picker over live data (the model sheet). Its height is fixed at first paint, so rows that
 * arrive while it is open never move the footer. Narrow screens show it as a bottom sheet.
 */
export function Sheet(props: DialogProps) {
  return <DialogShell {...props} fixed />;
}
