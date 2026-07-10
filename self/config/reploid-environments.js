/**
 * @fileoverview Editable environment templates for the Reploid self.
 */

import { ZERO_SEED_TOOLS } from './tool-surfaces.js';

const ZERO_STARTER_TOOLS = Object.freeze([
  'CreateTool',
  'created reader/lister',
  'created mutation tool'
]);

const ZERO_VISIBLE_SURFACE_LINE = `Visible Zero seed surface: ${ZERO_SEED_TOOLS.join(', ')}.`;
const ZERO_STARTER_TOOL_LINE = `Starter self-edit path: ${ZERO_STARTER_TOOLS.join(', ')}.`;

const TEMPLATE_DEFINITIONS = [
  {
    id: 'e0',
    label: 'E0',
    title: 'Bare',
    text: [
      'Browser-hosted JavaScript runtime.',
      'Canonical self lives under /self.',
      'Model writes go under /shadow and /artifacts.',
      ZERO_VISIBLE_SURFACE_LINE,
      ZERO_STARTER_TOOL_LINE,
      'Assume nothing else until verified.'
    ].join('\n')
  },
  {
    id: 'e1',
    label: 'E1',
    title: 'Storage',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Canonical self lives under /self.',
      'Model writes go under /shadow and /artifacts.',
      ZERO_VISIBLE_SURFACE_LINE,
      ZERO_STARTER_TOOL_LINE
    ].join('\n')
  },
  {
    id: 'e2',
    label: 'E2',
    title: 'Modules',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Canonical self lives under /self.',
      'Model writes go under /shadow and /artifacts.',
      ZERO_VISIBLE_SURFACE_LINE,
      'CreateTool stages, validates, installs, and loads Zero tool candidates. Created tools declare capabilities for VFS writes or tool loading.',
      'Put reusable candidates under /shadow and durable outputs under /artifacts.'
    ].join('\n')
  },
  {
    id: 'e3',
    label: 'E3',
    title: 'Browser',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Canonical self lives under /self.',
      'Model writes go under /shadow and /artifacts.',
      ZERO_VISIBLE_SURFACE_LINE,
      'CreateTool stages, validates, installs, and loads Zero tool candidates. Created tools declare capabilities for VFS writes or tool loading.',
      'Any web API may exist; verify it before relying on it.'
    ].join('\n')
  },
  {
    id: 'e4',
    label: 'E4',
    title: 'Guided',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Canonical self lives under /self.',
      'Model writes go under /shadow and /artifacts.',
      ZERO_VISIBLE_SURFACE_LINE,
      'CreateTool stages, validates, installs, and loads Zero tool candidates. Created tools declare capabilities for VFS writes or tool loading.',
      'Prefer small reversible changes, keep candidates under /shadow, and place evidence under /artifacts or opfs:/artifacts.',
      'Any web API may exist; verify it before relying on it.'
    ].join('\n')
  }
];

export const REPLOID_ENVIRONMENT_TEMPLATES = Object.freeze(TEMPLATE_DEFINITIONS);
export const DEFAULT_REPLOID_ENVIRONMENT_TEMPLATE_ID = 'e3';
export const DEFAULT_REPLOID_ENVIRONMENT_TEMPLATES = REPLOID_ENVIRONMENT_TEMPLATES;

export function listReploidEnvironmentTemplates() {
  return REPLOID_ENVIRONMENT_TEMPLATES;
}

export function getReploidEnvironmentTemplate(id) {
  return REPLOID_ENVIRONMENT_TEMPLATES.find((template) => template.id === id)
    || REPLOID_ENVIRONMENT_TEMPLATES.find((template) => template.id === DEFAULT_REPLOID_ENVIRONMENT_TEMPLATE_ID);
}

export function getDefaultReploidEnvironmentTemplate() {
  return getReploidEnvironmentTemplate(DEFAULT_REPLOID_ENVIRONMENT_TEMPLATE_ID);
}

export function getDefaultReploidEnvironment() {
  return getReploidEnvironmentTemplate(DEFAULT_REPLOID_ENVIRONMENT_TEMPLATE_ID)?.text || '';
}

export function findReploidEnvironmentTemplateId(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = REPLOID_ENVIRONMENT_TEMPLATES.find((template) => template.text.trim() === normalized);
  return match?.id || null;
}
