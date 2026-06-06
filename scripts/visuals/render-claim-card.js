import { EVIDENCE_THEME } from './evidence-theme.js';
import { badge, panel, textLine, wrappedText } from './svg-primitives.js';

export function renderClaimCard({ x, y, width, height, title, claim, evidence = [], tier = null }) {
  const content = [
    panel({ x, y, width, height, fill: EVIDENCE_THEME.palette.panelAlt }),
    textLine({ x: x + 18, y: y + 32, text: title, className: 'ev-node-title' }),
    wrappedText({
      x: x + 18,
      y: y + 62,
      lines: Array.isArray(claim) ? claim : [claim],
      className: 'ev-subtitle',
      lineHeight: 19
    })
  ];

  if (tier) {
    content.push(badge({ x: x + width - 178, y: y + 16, label: tier, width: 158 }));
  }

  const evidenceY = y + height - 28 - (evidence.length * 20);
  evidence.forEach((item, index) => {
    content.push(textLine({
      x: x + 18,
      y: evidenceY + (index * 20),
      text: item,
      className: 'ev-node-meta'
    }));
  });

  return `<g>${content.join('\n')}</g>`;
}

export default renderClaimCard;

