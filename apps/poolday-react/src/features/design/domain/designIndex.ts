/**
 * The design system as read from its sources by scripts/build-poolday-design-index.mjs:
 * tokens from tokens.css, primitives from packages/poolday-ui, compositions from the feature
 * screens. The page renders this index with the values tokens.css declares; it never restates one.
 */
export type TokenKind = 'color' | 'image' | 'shadow' | 'length' | 'radius' | 'border' | 'text' | 'weight' | 'family' | 'none';

export type DesignToken = {
  readonly name: string;
  readonly group: string;
  /** Raw scale (a literal, the same in both themes) or semantic (names a purpose, may map per theme). */
  readonly layer: 'raw' | 'semantic';
  readonly kind: TokenKind;
  /** Whether the light theme maps the token to a different value. */
  readonly themed: boolean;
  /** References to the token across every Poolday stylesheet. Zero means unused. */
  readonly uses: number;
  /** Components whose primitive rules read the token, directly or through another token. */
  readonly primitives: ReadonlyArray<string>;
};

export type DesignPrimitive = {
  readonly name: string;
  readonly file: string;
  readonly classes: ReadonlyArray<string>;
  readonly tokens: ReadonlyArray<string>;
  readonly compositions: ReadonlyArray<string>;
};

/** Declared values, read from tokens.css when the page loads; light is null where it does not differ. */
export type TokenValues = ReadonlyMap<string, { readonly dark: string; readonly light: string | null }>;

export type DesignComposition = {
  readonly name: string;
  readonly feature: string;
  readonly primitives: ReadonlyArray<string>;
};

export type DesignIndex = {
  readonly tokens: ReadonlyArray<DesignToken>;
  readonly primitives: ReadonlyArray<DesignPrimitive>;
  readonly compositions: ReadonlyArray<DesignComposition>;
};

/** Token groups in reading order: scales, then the semantic values each theme maps. */
export const TOKEN_GROUP_ORDER: ReadonlyArray<string> = [
  'size', 'space', 'radius', 'border', 'font', 'text', 'leading', 'weight', 'tracking', 'alpha', 'duration', 'ease', 'z',
  'color', 'surface', 'shadow', 'prism', 'other',
];
