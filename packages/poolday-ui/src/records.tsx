import { useRef, type CSSProperties, type ReactNode } from 'react';
import { dataProps, type DataAttributes } from './internal.js';

/** A stored record or an error shown verbatim: monospaced, on an inset well, scrolling sideways when long. */
export function CodeBlock({ children, label, data }: { readonly children: string; readonly label?: string; readonly data?: DataAttributes }) {
  return (
    <pre className="pool-well pool-caption pool-mono" aria-label={label} {...dataProps(data)}>
      {children}
    </pre>
  );
}

/**
 * Recorded shares of one whole as a proportional bar, for example each computer's share of an answer's step time.
 * `label` states every share in words; the bar itself is decoration for sighted readers.
 */
export function ShareBar({ label, shares, data }: { readonly label: string; readonly shares: ReadonlyArray<number>; readonly data?: DataAttributes }) {
  return (
    <div className="pool-bar" role="img" aria-label={label} {...dataProps(data)}>
      {shares.map((share, index) => (
        <span key={index} style={{ '--pool-param-share': String(share) } as CSSProperties} />
      ))}
    </div>
  );
}

/**
 * Chooses files from this device. `children` renders the control that opens the chooser (a Button or a ListItem
 * given `open` as its action), so the chooser takes whatever look the place needs; `label` names the chooser itself.
 */
export function FilePicker({
  label,
  accept,
  multiple = false,
  onFiles,
  children,
  data,
}: {
  readonly label: string;
  readonly accept?: string;
  readonly multiple?: boolean;
  readonly onFiles: (files: File[]) => void;
  readonly children: (open: () => void) => ReactNode;
  readonly data?: DataAttributes;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      {children(() => input.current?.click())}
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        aria-label={label}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          // Cleared, so choosing the same file again reports it again.
          event.currentTarget.value = '';
          if (files.length) onFiles(files);
        }}
        {...dataProps(data)}
      />
    </>
  );
}
