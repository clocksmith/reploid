import { EVIDENCE_THEME } from './evidence-theme.js';
import { connector, nodeBox, svgDocument, textLine, wrappedText } from './svg-primitives.js';

function nodeCenter(node) {
  return {
    x: node.x + (node.width / 2),
    y: node.y + (node.height / 2)
  };
}

function edgePoint(node, side) {
  if (side === 'left') return { x: node.x, y: node.y + (node.height / 2) };
  if (side === 'right') return { x: node.x + node.width, y: node.y + (node.height / 2) };
  if (side === 'top') return { x: node.x + (node.width / 2), y: node.y };
  if (side === 'bottom') return { x: node.x + (node.width / 2), y: node.y + node.height };
  return nodeCenter(node);
}

export function renderFlowDiagram({
  width = 1200,
  height = 720,
  title,
  subtitle = [],
  desc = '',
  nodes = [],
  edges = [],
  overlays = []
}) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const body = [
    textLine({ x: 52, y: 58, text: title, className: 'ev-title' }),
    wrappedText({
      x: 52,
      y: 86,
      lines: Array.isArray(subtitle) ? subtitle : [subtitle],
      className: 'ev-subtitle',
      lineHeight: 20
    })
  ];

  edges.forEach((edge) => {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) return;
    const start = edgePoint(from, edge.fromSide || 'right');
    const end = edgePoint(to, edge.toSide || 'left');
    body.push(connector({
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      dashed: edge.dashed,
      label: edge.label,
      labelDx: edge.labelDx,
      labelDy: edge.labelDy,
      color: edge.color
    }));
  });

  nodes.forEach((node) => {
    body.push(nodeBox({
      ...node,
      accent: node.accent || EVIDENCE_THEME.palette.accent
    }));
  });

  overlays.forEach((overlay) => body.push(overlay));

  return svgDocument({
    width,
    height,
    title,
    desc: desc || title,
    body: body.join('\n')
  });
}

export default renderFlowDiagram;

