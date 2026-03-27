/**
 * @fileoverview Editable environment templates for Absolute Zero.
 */

const TEMPLATE_DEFINITIONS = [
  {
    id: 'e0',
    label: 'E0',
    title: 'Bare',
    text: [
      'Files persist in VFS.',
      'Visible tools: ReadFile, WriteFile, LoadModule.',
      'Do not assume any other capability exists until you verify it.',
      'When foreground work stalls or reaches a local milestone, continue with safe self-improvement instead of treating the task as finished.'
    ].join('\n')
  },
  {
    id: 'e1',
    label: 'E1',
    title: 'Storage',
    text: [
      'Files persist in VFS.',
      'OPFS can store larger blobs and binary artifacts.',
      'Writable roots: /kernel, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'Visible tools: ReadFile, WriteFile, LoadModule.',
      'When foreground work stalls or reaches a local milestone, continue with safe self-improvement instead of treating the task as finished.'
    ].join('\n')
  },
  {
    id: 'e2',
    label: 'E2',
    title: 'Modules',
    text: [
      'Files persist in VFS.',
      'Writable roots: /kernel, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'LoadModule can load a VFS JavaScript module and register callable tool exports.',
      'Put reusable tools under /tools and durable notes under /.memory.',
      'When foreground work stalls or reaches a local milestone, continue with safe self-improvement instead of treating the task as finished.'
    ].join('\n')
  },
  {
    id: 'e3',
    label: 'E3',
    title: 'Browser',
    text: [
      'Files persist in VFS and OPFS can store larger artifacts.',
      'Writable roots: /kernel, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'LoadModule can load a VFS JavaScript module and register callable tool exports.',
      'Browser APIs such as DOM, fetch, workers, canvas, iframes, storage, and WebGPU may exist; verify them before relying on them.',
      'When foreground work stalls or reaches a local milestone, continue with safe self-improvement instead of treating the task as finished.'
    ].join('\n')
  },
  {
    id: 'e4',
    label: 'E4',
    title: 'Guided',
    text: [
      'Files persist in VFS and OPFS can store larger artifacts.',
      'Writable roots: /kernel, /tools, /.memory, /artifacts, and opfs:/artifacts.',
      'LoadModule can load a VFS JavaScript module and register callable tool exports.',
      'Prefer small reversible changes, write narrow task-specific tools, keep notes under /.memory, and place outputs under /artifacts or opfs:/artifacts.',
      'Browser APIs may exist, but verify them before relying on them.',
      'When foreground work stalls or reaches a local milestone, continue with safe self-improvement instead of treating the task as finished.'
    ].join('\n')
  }
];

export const ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATES = Object.freeze(TEMPLATE_DEFINITIONS);
export const DEFAULT_ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATE_ID = 'e3';

export function listAbsoluteZeroEnvironmentTemplates() {
  return ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATES;
}

export function getAbsoluteZeroEnvironmentTemplate(id) {
  return ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATES.find((template) => template.id === id)
    || ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATES.find((template) => template.id === DEFAULT_ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATE_ID);
}

export function getDefaultAbsoluteZeroEnvironment() {
  return getAbsoluteZeroEnvironmentTemplate(DEFAULT_ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATE_ID)?.text || '';
}

export function findAbsoluteZeroEnvironmentTemplateId(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = ABSOLUTE_ZERO_ENVIRONMENT_TEMPLATES.find((template) => template.text.trim() === normalized);
  return match?.id || null;
}
