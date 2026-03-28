/**
 * @fileoverview Editable environment templates for the Reploid self.
 */

const TEMPLATE_DEFINITIONS = [
  {
    id: 'e0',
    label: 'E0',
    title: 'Bare',
    text: [
      'Browser-hosted JavaScript runtime.',
      'Writable roots: /.system, /self, /capsule, /tools, /.memory, /artifacts.',
      'Visible tools: ReadFile, WriteFile, LoadModule.',
      'Assume nothing else until verified.'
    ].join('\n')
  },
  {
    id: 'e1',
    label: 'E1',
    title: 'Storage',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Writable roots: /.system, /self, /capsule, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'Visible tools: ReadFile, WriteFile, LoadModule.'
    ].join('\n')
  },
  {
    id: 'e2',
    label: 'E2',
    title: 'Modules',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Writable roots: /.system, /self, /capsule, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'LoadModule registers JavaScript tools from /tools or /self.',
      'Put reusable tools under /tools and durable notes under /.memory.'
    ].join('\n')
  },
  {
    id: 'e3',
    label: 'E3',
    title: 'Browser',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Writable roots: /.system, /self, /capsule, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'LoadModule registers JavaScript tools from /tools or /self.',
      'Any web API may exist; verify it before relying on it.'
    ].join('\n')
  },
  {
    id: 'e4',
    label: 'E4',
    title: 'Guided',
    text: [
      'Browser-hosted JavaScript runtime with VFS and OPFS.',
      'Writable roots: /.system, /self, /capsule, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'LoadModule registers JavaScript tools from /tools or /self.',
      'Prefer small reversible changes, keep durable notes under /.memory, and place outputs under /artifacts or opfs:/artifacts.',
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
