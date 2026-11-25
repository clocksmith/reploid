import type { CSSProperties } from 'react';

/** How a token's value is previewed on the design page. */
export type SwatchKind = 'color' | 'image' | 'shadow' | 'length' | 'radius' | 'border' | 'text' | 'weight' | 'family' | 'none';

const TOKEN_NAME = /^--pool-[a-z0-9-]+$/;

/**
 * A live preview of one token: the swatch reads the token itself through a parameter, so it
 * always shows the value the current theme resolves, never a copy.
 */
export function TokenSwatch({ name, kind }: { readonly name: string; readonly kind: SwatchKind }) {
  if (kind === 'none' || !TOKEN_NAME.test(name)) return <span className="pool-swatch pool-swatch-none" aria-hidden="true" />;
  const style = { '--pool-param-swatch': `var(${name})` } as CSSProperties;
  const sample = kind === 'text' || kind === 'weight' || kind === 'family';
  return (
    <span className={`pool-swatch pool-swatch-${kind}`} style={style} aria-hidden="true">
      {sample ? 'Aa' : null}
    </span>
  );
}
