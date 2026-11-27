import type { ReactNode } from 'react';
import { cx } from './internal.js';

// Line icons on a 24-unit grid, the same set as apps/poolday/ui/components/interface-icons.js.
// Size and colour come from the icon box primitive (20px, `currentColor`).
const PATHS = {
  privacy: <path d="m12 3 8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 1 1 4 3c-1 .5-1 1-1 2m0 3v.1" />
    </>
  ),
  chevron: <path d="m7 10 5 5 5-5" />,
  next: <path d="m10 7 5 5-5 5" />,
  download: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  upload: <path d="M12 16V5m-5 5 5-5 5 5M5 20h14" />,
  link: <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1m2 4a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />,
  plus: <path d="M12 5v14M5 12h14" />,
  attach: <path d="m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2m-7 13 8-8" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 5 5" />
    </>
  ),
  send: <path d="M12 20V4m-6 6 6-6 6 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  threads: (
    <>
      <circle cx="5" cy="6" r="1" />
      <circle cx="5" cy="12" r="1" />
      <circle cx="5" cy="18" r="1" />
      <path d="M10 6h10M10 12h10M10 18h10" />
    </>
  ),
  model: <path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 10v8M3 8l9 5 9-5M7.5 5.5l9 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  retry: <path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  tokens: <path d="M8 4 6 20M18 4l-2 16M3 9h18M2 15h18" />,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  peers: (
    <>
      <rect x="8" y="2" width="8" height="6" rx="1" />
      <rect x="1" y="15" width="8" height="6" rx="1" />
      <rect x="15" y="15" width="8" height="6" rx="1" />
      <path d="M12 8v4M5 15v-3h14v3" />
    </>
  ),
  device: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="10" cy="18" r="2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as readonly IconName[];

/** A line icon centred in its box; decorative, so the control carrying it owns the name. */
export function Icon({ name, size = 'md' }: { readonly name: IconName; readonly size?: 'sm' | 'md' }) {
  return (
    <span className={cx('pool-icon-box', size === 'sm' && 'pool-icon-box-sm')} aria-hidden="true">
      <IconGlyph name={name} />
    </span>
  );
}

/** The bare glyph, for controls whose own box centres it (icon buttons, the option mark). */
export function IconGlyph({ name }: { readonly name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
