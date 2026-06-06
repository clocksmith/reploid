import { EVIDENCE_THEME, evidenceSvgStyles, fontCss } from './evidence-theme.js';

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function attrs(values = {}) {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ');
}

export function svgDocument({ width, height, title, desc, body, defs = '' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">${escapeXml(desc || title)}</desc>
  <defs>
    <style>
${evidenceSvgStyles()}
    </style>
    <marker id="ev-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 12 6 L 0 12 z" fill="${EVIDENCE_THEME.palette.accent}" />
    </marker>
    <marker id="ev-arrow-muted" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="strokeWidth">
      <path d="M 0 0 L 12 6 L 0 12 z" fill="${EVIDENCE_THEME.palette.muted}" />
    </marker>
${defs}
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="${EVIDENCE_THEME.palette.bg}" />
${body}
</svg>
`;
}

export function panel({ x, y, width, height, fill = EVIDENCE_THEME.palette.panel, stroke = EVIDENCE_THEME.palette.border, radius = EVIDENCE_THEME.radius.panel, className = '' }) {
  return `<rect ${attrs({ x, y, width, height, rx: radius, class: className })} fill="${fill}" stroke="${stroke}" stroke-width="${EVIDENCE_THEME.stroke.thin}" />`;
}

export function textLine({ x, y, text, className = '', anchor = 'start', fill = null, size = null, weight = null, family = null }) {
  const style = [
    fill ? `fill:${fill}` : '',
    size ? `font-size:${size}px` : '',
    weight ? `font-weight:${weight}` : '',
    family ? `font-family:${fontCss(family)}` : ''
  ].filter(Boolean).join(';');
  return `<text ${attrs({ x, y, 'text-anchor': anchor, class: className, style })}>${escapeXml(text)}</text>`;
}

export function wrappedText({ x, y, lines = [], className = '', lineHeight = 18, anchor = 'start' }) {
  return lines.map((line, index) => textLine({
    x,
    y: y + (index * lineHeight),
    text: line,
    className,
    anchor
  })).join('\n');
}

export function badge({ x, y, label, color = EVIDENCE_THEME.palette.accent, width = null }) {
  const textWidth = width || Math.max(72, (String(label).length * 7.1) + 20);
  return `<g>
  <rect x="${x}" y="${y}" width="${textWidth}" height="24" rx="${EVIDENCE_THEME.radius.badge}" fill="${color}" fill-opacity="0.14" stroke="${color}" stroke-width="${EVIDENCE_THEME.stroke.thin}" />
  <text x="${x + 10}" y="${y + 16}" class="ev-label" fill="${color}" style="fill:${color};font-family:${fontCss('mono')}">${escapeXml(label)}</text>
</g>`;
}

export function connector({ x1, y1, x2, y2, dashed = false, label = '', labelDx = 0, labelDy = -8, color = null }) {
  const stroke = color || (dashed ? EVIDENCE_THEME.palette.muted : EVIDENCE_THEME.palette.accent);
  const marker = dashed ? 'ev-arrow-muted' : 'ev-arrow';
  const dash = dashed ? ' stroke-dasharray="6 6"' : '';
  const line = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${EVIDENCE_THEME.stroke.normal}"${dash} marker-end="url(#${marker})" />`;
  if (!label) return line;
  return `${line}
${textLine({
    x: (x1 + x2) / 2 + labelDx,
    y: (y1 + y2) / 2 + labelDy,
    text: label,
    className: 'ev-label',
    anchor: 'middle'
  })}`;
}

export function nodeBox({ x, y, width, height, title, meta = '', badgeLabel = '', accent = EVIDENCE_THEME.palette.accent }) {
  const content = [
    panel({ x, y, width, height, fill: EVIDENCE_THEME.palette.panelAlt, stroke: accent }),
    textLine({ x: x + 16, y: y + 29, text: title, className: 'ev-node-title' })
  ];
  if (meta) {
    content.push(textLine({ x: x + 16, y: y + 52, text: meta, className: 'ev-node-meta' }));
  }
  if (badgeLabel) {
    content.push(badge({ x: x + 16, y: y + height - 34, label: badgeLabel, color: accent }));
  }
  return `<g>${content.join('\n')}</g>`;
}

