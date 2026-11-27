import { useEffect, useId, useRef } from 'react';
import { dataProps, type DataAttributes } from './internal.js';

/**
 * The decorative prism: glass artwork beside a page's title. It is artwork only: it never signals execution and is
 * hidden from assistive technology. The still drawing takes the prism tokens; `enhance`, when given, may draw a
 * light effect on the prism's canvas and returns its cleanup. The enhancer marks the prism
 * `data-prism-state="ready"` once it draws and must not animate under reduced motion; until then, and under forced
 * colours, the still shows.
 */
export function Prism({ enhance, data }: { readonly enhance?: (shell: HTMLElement) => () => void; readonly data?: DataAttributes }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const shell = useRef<HTMLSpanElement>(null);
  useEffect(() => (shell.current && enhance ? enhance(shell.current) : undefined), [enhance]);
  return (
    <span ref={shell} className="pool-prism-art" aria-hidden="true" data-pool-prism="" {...dataProps(data)}>
      <svg className="pool-prism-still" viewBox="0 0 480 420" focusable="false">
        <defs>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2="1">
            <stop className="pool-prism-stop-light" />
            <stop className="pool-prism-stop-mid" offset=".45" />
            <stop className="pool-prism-stop-cool" offset=".7" />
            <stop className="pool-prism-stop-warm" offset="1" />
          </linearGradient>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="1">
            <stop className="pool-prism-stop-green" />
            <stop className="pool-prism-stop-light" offset=".4" />
            <stop className="pool-prism-stop-cyan" offset=".65" />
            <stop className="pool-prism-stop-violet" offset="1" />
          </linearGradient>
        </defs>
        <ellipse className="pool-prism-shadow" cx="240" cy="344" rx="154" ry="39" />
        <g stroke={`url(#${id}-edge)`} className="pool-prism-facets">
          <path d="M239 55 373 167 270 304 116 200Z" fill={`url(#${id}-glass)`} />
          <path className="pool-prism-facet-light" d="M239 55 244 186 116 200Z" />
          <path className="pool-prism-facet-mid" d="M239 55 373 167 244 186Z" />
          <path className="pool-prism-facet-cool" d="M244 186 373 167 270 304Z" />
          <path className="pool-prism-facet-warm" d="M116 200 244 186 270 304Z" />
        </g>
      </svg>
      <canvas className="pool-prism-canvas" data-pool-prism-canvas="" />
    </span>
  );
}
