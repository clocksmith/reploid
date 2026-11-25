import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

// Bounded Markdown presentation, ported from apps/poolday/ui/components/message-markdown.js: the
// same grammar and limits, rendered as React elements. No HTML is evaluated; links open only
// http(s) URLs without credentials; numbered citations link only to sources the caller names.
type Node = { readonly text: string } | { readonly tag: string; readonly children: Node[]; readonly attrs: Record<string, string> };
const text = (value: string): Node => ({ text: value });
const element = (tag: string, children: Node[], attrs: Record<string, string> = {}): Node => ({ tag, children, attrs });
const MAX_FORMATTED_CHARACTERS = 100000;
const MAX_BLOCKS = 2000;

function inline(value: string, targets: ReadonlyMap<string, string>, depth = 0): Node[] {
  if (depth > 4) return [text(value)];
  const pattern = /\[D\d+:P\d+\]|`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^\s)]+)\)|\[(\d{1,3})\]/g;
  const nodes: Node[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    if (nodes.length > 2000) break;
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text(value.slice(cursor, index)));
    if (match[6]) {
      const target = targets.get(match[6]);
      nodes.push(target ? element('a', [text(match[0])], { href: `#${target}`, 'data-source-reference': '' }) : text(match[0]));
    } else if (/^\[D\d+:P\d+\]$/.test(match[0])) {
      const target = targets.get(match[0].slice(1, -1));
      nodes.push(target ? element('a', [text(match[0])], { href: `#${target}`, 'data-source-reference': '' }) : element('span', [text(match[0])], { title: 'No supplied passage has this reference' }));
    } else if (match[1]) nodes.push(element('code', [text(match[1])]));
    else if (match[2] || match[3]) nodes.push(element(match[2] ? 'strong' : 'em', inline(match[2] || match[3] || '', targets, depth + 1)));
    else {
      let href: string | undefined;
      try {
        const url = new URL(match[5] ?? '');
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) href = url.href;
      } catch {
        href = undefined;
      }
      nodes.push(href ? element('a', inline(match[4] ?? '', targets, depth + 1), { href, target: '_blank', rel: 'noopener noreferrer' }) : text(match[0]));
    }
    cursor = index + match[0].length;
  }
  if (cursor < value.length || !nodes.length) nodes.push(text(value.slice(cursor)));
  return nodes;
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
const tableRule = (line: string | undefined) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line || '');

function parse(value: string, targets: ReadonlyMap<string, string>): Node[] {
  if (value.length > MAX_FORMATTED_CHARACTERS) return [element('p', [text(value)])];
  const lines = value.split('\n');
  const blocks: Node[] = [];
  for (let i = 0; i < lines.length; ) {
    if (blocks.length >= MAX_BLOCKS) {
      blocks.push(element('p', [text(lines.slice(i).join('\n'))]));
      break;
    }
    const line = lines[i] ?? '';
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i] ?? '')) code.push(lines[i++] ?? '');
      if (i < lines.length) i++;
      blocks.push(element('pre', [element('code', [text(code.join('\n'))])]));
    } else if (/^#{1,6}\s+/.test(line)) {
      const [, marks = '#', content = ''] = line.match(/^(#{1,6})\s+(.*)$/) ?? [];
      blocks.push(element(`h${Math.min(marks.length + 2, 6)}`, inline(content, targets)));
      i++;
    } else if (tableRule(lines[i + 1])) {
      const headings = cells(line);
      i += 2;
      const rows: Node[] = [];
      while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim()) {
        rows.push(element('tr', cells(lines[i++] ?? '').slice(0, headings.length).map((cell) => element('td', inline(cell, targets)))));
      }
      blocks.push(element('table', [element('thead', [element('tr', headings.map((cell) => element('th', inline(cell, targets), { scope: 'col' })))]), element('tbody', rows)]));
    } else if (/^\s*(?:[-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: Node[] = [];
      const itemPattern = ordered ? /^\s*\d+\. (.*)$/ : /^\s*[-*+] (.*)$/;
      while (i < lines.length && itemPattern.test(lines[i] ?? '')) items.push(element('li', inline((lines[i++] ?? '').match(itemPattern)?.[1] ?? '', targets)));
      blocks.push(element(ordered ? 'ol' : 'ul', items, ordered ? { start: line.match(/\d+/)?.[0] ?? '1' } : {}));
    } else {
      const prose = [line];
      i++;
      while (i < lines.length && (lines[i] ?? '').trim() && !/^(?:```|#{1,6}\s)|^\s*(?:[-*+] |\d+\. )/.test(lines[i] ?? '') && !tableRule(lines[i + 1])) prose.push(lines[i++] ?? '');
      if (prose.join('').trim()) blocks.push(element('p', inline(prose.join('\n'), targets)));
    }
  }
  return blocks;
}

const ALLOWED = new Set(['p', 'pre', 'code', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'span']);

type CopyLabels = { readonly copy: string; readonly copied: string } | null;
const plainText = (nodes: Node[]): string => nodes.map((node) => ('text' in node ? node.text : plainText(node.children))).join('');

/** A code block with its own Copy action, which says when it copied. */
function CodeBlock({ code, labels, children }: { readonly code: string; readonly labels: { readonly copy: string; readonly copied: string }; readonly children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre>
      <button
        type="button"
        className="pool-button btn-ghost pool-caption"
        data-copy-code=""
        onClick={() => {
          void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined);
        }}
      >
        {copied ? labels.copied : labels.copy}
      </button>
      {children}
    </pre>
  );
}

/**
 * A run of text that grows in place: while an answer streams, new text is appended to the same text node, so a
 * reader's selection and the node itself survive each update. Other changes replace the text.
 */
function StreamText({ text }: { readonly text: string }) {
  const span = useRef<HTMLSpanElement>(null);
  const shown = useRef('');
  useLayoutEffect(() => {
    const node = span.current;
    if (!node || shown.current === text) return;
    const leaf = node.firstChild;
    if (leaf instanceof Text && shown.current && text.startsWith(shown.current)) leaf.appendData(text.slice(shown.current.length));
    else node.textContent = text;
    shown.current = text;
  }, [text]);
  return <span ref={span} data-text-block="" />;
}

function render(nodes: Node[], prefix: string, labels: CopyLabels = null): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    if ('text' in node) return <StreamText key={key} text={node.text} />;
    if (!ALLOWED.has(node.tag)) return node.children.length ? render(node.children, `${key}.`, labels) : null;
    if (node.tag === 'pre' && labels) {
      return (
        <CodeBlock key={key} code={plainText(node.children)} labels={labels}>
          {render(node.children, `${key}.`)}
        </CodeBlock>
      );
    }
    const Tag = node.tag as 'span';
    const { scope, start, href, target, rel, title } = node.attrs;
    const props: Record<string, string | number | undefined> = { scope, href, target, rel, title };
    if (start !== undefined) props.start = Number(start);
    if ('data-source-reference' in node.attrs) props['data-source-reference'] = '';
    return (
      <Tag key={key} {...props}>
        {render(node.children, `${key}.`, labels)}
      </Tag>
    );
  });
}

/** Model output or a message, rendered from bounded Markdown into the prose primitive. */
export function Prose({
  markdown,
  sources = new Map(),
  label,
  copyLabels = null,
}: {
  readonly markdown: string;
  /** Citation markers that link: marker text ("1" or "D1:P2") to the id of its source element. */
  readonly sources?: ReadonlyMap<string, string>;
  readonly label?: string;
  /** With labels, each code block offers Copy. */
  readonly copyLabels?: { readonly copy: string; readonly copied: string } | null;
}) {
  // A citation opens and focuses the passage it names, inside its folded document, without leaving the page.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as Element).closest?.('[data-source-reference]');
    const id = link?.getAttribute('href')?.slice(1);
    const passage = id ? link?.ownerDocument.getElementById(id) : null;
    if (!passage) return;
    event.preventDefault();
    const folded = passage.closest('details');
    if (folded) folded.open = true;
    if (!passage.hasAttribute('tabindex')) passage.setAttribute('tabindex', '-1');
    passage.focus({ preventScroll: true });
    passage.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div className="pool-prose pool-prose-blocks pool-body" aria-label={label} onClick={onClick}>
      {render(parse(markdown, sources), 'p', copyLabels)}
    </div>
  );
}
