import { EVIDENCE_THEME } from './evidence-theme.js';
import { badge, panel, textLine } from './svg-primitives.js';

export function renderMetricStrip({ x, y, width, metrics = [], title = '' }) {
  const stripHeight = 74;
  const content = [
    panel({ x, y, width, height: stripHeight, fill: EVIDENCE_THEME.palette.panel })
  ];
  if (title) {
    content.push(textLine({ x: x + 16, y: y + 24, text: title, className: 'ev-label' }));
  }

  const startX = x + 16;
  const metricY = y + (title ? 38 : 24);
  const gap = 12;
  const available = width - 32 - (gap * Math.max(0, metrics.length - 1));
  const metricWidth = metrics.length > 0 ? available / metrics.length : available;

  metrics.forEach((metric, index) => {
    const metricX = startX + (index * (metricWidth + gap));
    content.push(badge({
      x: metricX,
      y: metricY,
      width: metricWidth,
      label: `${metric.label}: ${metric.value}`,
      color: metric.color || EVIDENCE_THEME.palette.accent
    }));
  });

  return `<g>${content.join('\n')}</g>`;
}

export default renderMetricStrip;

