export const EVIDENCE_THEME = Object.freeze({
  palette: Object.freeze({
    bg: '#050607',
    panel: '#0b0d0f',
    panelAlt: '#101317',
    border: '#2a2f35',
    text: '#f2f2f0',
    muted: '#9ca3af',
    good: '#86efac',
    warn: '#fde68a',
    bad: '#fca5a5',
    accent: '#93c5fd'
  }),
  fonts: Object.freeze({
    title: 'Inter, Segoe UI, Helvetica Neue, Arial, sans-serif',
    body: 'Inter, Segoe UI, Helvetica Neue, Arial, sans-serif',
    mono: 'SFMono-Regular, Menlo, Consolas, Liberation Mono, monospace'
  }),
  stroke: Object.freeze({
    thin: 1.25,
    normal: 1.75,
    heavy: 2.5
  }),
  radius: Object.freeze({
    panel: 4,
    badge: 3
  }),
  spacing: Object.freeze({
    xs: 6,
    sm: 10,
    md: 16,
    lg: 24,
    xl: 36
  })
});

export const TRUST_TIER_STYLES = Object.freeze({
  T1: Object.freeze({ label: 'T1 signed receipt', color: EVIDENCE_THEME.palette.accent }),
  T2: Object.freeze({ label: 'T2 canary audited', color: EVIDENCE_THEME.palette.warn }),
  T3: Object.freeze({ label: 'T3 redundant agreement', color: EVIDENCE_THEME.palette.good }),
  T4: Object.freeze({ label: 'T4 transcript sampled', color: EVIDENCE_THEME.palette.good }),
  T5: Object.freeze({ label: 'T5 program bundle proof', color: EVIDENCE_THEME.palette.good })
});

export const EVIDENCE_DIAGRAM_TYPES = Object.freeze([
  'architecture-flow',
  'claim-evidence-card',
  'benchmark-comparison',
  'receipt-lifecycle'
]);

export function fontCss(kind = 'body') {
  return EVIDENCE_THEME.fonts[kind] || EVIDENCE_THEME.fonts.body;
}

export function evidenceSvgStyles() {
  const { palette } = EVIDENCE_THEME;
  return `
    text { fill: ${palette.text}; font-family: ${fontCss('body')}; letter-spacing: 0; }
    .ev-title { font-family: ${fontCss('title')}; font-size: 30px; font-weight: 700; }
    .ev-subtitle { font-size: 15px; fill: ${palette.muted}; font-weight: 500; }
    .ev-node-title { font-size: 17px; font-weight: 700; }
    .ev-node-meta { font-size: 12px; fill: ${palette.muted}; font-family: ${fontCss('mono')}; }
    .ev-label { font-size: 12px; fill: ${palette.muted}; font-weight: 600; }
    .ev-mono { font-family: ${fontCss('mono')}; }
    .ev-small { font-size: 11px; }
  `.trim();
}

