#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVIDENCE_THEME, TRUST_TIER_STYLES } from './visuals/evidence-theme.js';
import { renderFlowDiagram } from './visuals/render-flow-diagram.js';
import { renderMetricStrip } from './visuals/render-metric-strip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(REPO_ROOT, 'docs', 'visuals');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'receipt-backed-browser-inference-loop.svg');

const { palette } = EVIDENCE_THEME;

const nodes = [
  {
    id: 'requester',
    x: 60,
    y: 170,
    width: 180,
    height: 98,
    title: 'Requester',
    meta: '/run prompt + policy',
    badgeLabel: 'job'
  },
  {
    id: 'coordinator',
    x: 310,
    y: 170,
    width: 190,
    height: 98,
    title: 'Coordinator',
    meta: 'assign + notary',
    badgeLabel: 'policy'
  },
  {
    id: 'provider',
    x: 570,
    y: 170,
    width: 205,
    height: 98,
    title: 'Provider Browser',
    meta: '/contribute tab',
    badgeLabel: 'identity'
  },
  {
    id: 'doppler',
    x: 850,
    y: 170,
    width: 210,
    height: 98,
    title: 'Doppler Runtime',
    meta: 'WebGPU model run',
    badgeLabel: 'model hash'
  },
  {
    id: 'receipt',
    x: 570,
    y: 380,
    width: 205,
    height: 106,
    title: 'Signed Receipt',
    meta: 'output + token hashes',
    badgeLabel: 'provider sig',
    accent: palette.good
  },
  {
    id: 'verifier',
    x: 310,
    y: 384,
    width: 190,
    height: 98,
    title: 'Verifier',
    meta: 'hash + policy checks',
    badgeLabel: 'decision',
    accent: palette.warn
  },
  {
    id: 'acceptance',
    x: 60,
    y: 384,
    width: 180,
    height: 98,
    title: 'Acceptance',
    meta: 'requester countersign',
    badgeLabel: 'points event',
    accent: palette.good
  }
];

const edges = [
  { from: 'requester', to: 'coordinator', label: 'job + policy' },
  { from: 'coordinator', to: 'provider', label: 'assignment' },
  { from: 'provider', to: 'doppler', label: 'prompt' },
  {
    from: 'doppler',
    to: 'receipt',
    fromSide: 'bottom',
    toSide: 'top',
    label: 'output',
    labelDx: 40
  },
  {
    from: 'provider',
    to: 'receipt',
    fromSide: 'bottom',
    toSide: 'top',
    label: 'signature',
    labelDx: -54,
    color: palette.good
  },
  {
    from: 'coordinator',
    to: 'verifier',
    fromSide: 'bottom',
    toSide: 'top',
    dashed: true,
    label: 'assignment record'
  },
  {
    from: 'receipt',
    to: 'verifier',
    fromSide: 'left',
    toSide: 'right',
    dashed: true,
    label: 'verify receipt'
  },
  {
    from: 'verifier',
    to: 'acceptance',
    fromSide: 'left',
    toSide: 'right',
    dashed: true,
    label: 'accept/reject'
  },
  {
    from: 'acceptance',
    to: 'requester',
    fromSide: 'top',
    toSide: 'bottom',
    label: 'accepted result',
    color: palette.good,
    labelDx: -62,
    labelDy: 4
  }
];

const overlays = [
  renderMetricStrip({
    x: 60,
    y: 570,
    width: 1000,
    title: 'Trust roadmap',
    metrics: [
      { label: 'T1', value: 'signed receipt', color: TRUST_TIER_STYLES.T1.color },
      { label: 'T2', value: 'canary audited', color: TRUST_TIER_STYLES.T2.color },
      { label: 'T3', value: 'redundant agreement', color: TRUST_TIER_STYLES.T3.color }
    ]
  })
];

const svg = renderFlowDiagram({
  width: 1120,
  height: 700,
  title: 'Receipt-backed browser inference loop',
  subtitle: [
    'A requester gets output plus a verifier-readable execution receipt.',
    'The browser provider is useful but untrusted; policy, signatures, hashes, and acceptance create the evidence trail.'
  ],
  desc: 'Flow diagram showing requester to coordinator to provider browser to Doppler runtime, then signed receipt verification, requester acceptance, and trust tiers T1 through T3.',
  nodes,
  edges,
  overlays
});

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
fs.writeFileSync(OUTPUT_PATH, svg, 'utf8');
console.log(`wrote ${OUTPUT_PATH}`);

