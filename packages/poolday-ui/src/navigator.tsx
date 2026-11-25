import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from './internal.js';

export type NavigatorItem = {
  readonly id: string;
  readonly label: string;
  readonly children?: ReadonlyArray<NavigatorItem>;
};

/**
 * In-page or in-app destinations. Exactly one item is current. A parent of the current item is
 * marked only for layouts that fold its children away, so one selected state shows at a time.
 */
export function Navigator({
  items,
  current,
  onSelect,
}: {
  readonly items: ReadonlyArray<NavigatorItem>;
  readonly current: string | null;
  readonly onSelect: (id: string) => void;
}) {
  const contains = (item: NavigatorItem): boolean => (item.children ?? []).some((child) => child.id === current || contains(child));
  const renderItems = (list: ReadonlyArray<NavigatorItem>, nested: boolean) => (
    <ul className={cx('pool-nav-list', nested && 'pool-nav-list-nested')}>
      {list.map((item) => (
        <li key={item.id}>
          <a
            className={cx('pool-button', 'btn-ghost', 'pool-plain', 'pool-nav-item', nested && 'pool-caption')}
            href={`#${item.id}`}
            aria-current={item.id === current ? 'true' : undefined}
            // Where nested items are folded away (the narrow bar), the parent stands in for the current child.
            data-contains-current={contains(item) || undefined}
            onClick={(event) => {
              event.preventDefault();
              onSelect(item.id);
            }}
          >
            {item.label}
          </a>
          {item.children && item.children.length > 0 && renderItems(item.children, true)}
        </li>
      ))}
    </ul>
  );
  return renderItems(items, false);
}

const flatten = (items: ReadonlyArray<NavigatorItem>): string[] =>
  items.flatMap((item) => [item.id, ...flatten(item.children ?? [])]);

/**
 * Tracks which in-page section is being read, for a Navigator. Selecting an item scrolls to it and
 * keeps it current even where the page cannot scroll it to the top (the last sections).
 */
export function useScrollSpy(items: ReadonlyArray<NavigatorItem>): {
  readonly current: string | null;
  readonly select: (id: string) => void;
} {
  const ids = flatten(items);
  const key = ids.join('\n');
  const [current, setCurrent] = useState<string | null>(ids[0] ?? null);
  const pinned = useRef<string | null>(null);

  useEffect(() => {
    const list = key.split('\n').filter(Boolean);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const threshold = window.innerHeight * 0.25;
      let active = list[0] ?? null;
      for (const id of list) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= threshold) active = id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (pinned.current && (atEnd || active === pinned.current)) active = pinned.current;
      setCurrent(active);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const release = () => {
      pinned.current = null;
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('keydown', release);
    schedule();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchstart', release);
      window.removeEventListener('keydown', release);
    };
  }, [key]);

  const select = useCallback((id: string) => {
    pinned.current = id;
    setCurrent(id);
    const element = document.getElementById(id);
    if (element) {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
      element.focus({ preventScroll: true });
    }
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  return { current, select };
}
