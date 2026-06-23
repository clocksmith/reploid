/**
 * @fileoverview Persona Manager
 * dynamic system prompt construction based on config.
 */

import { getCurrentReploidStorage as getReploidStorage } from '../instance.js';

const PersonaManager = {
  metadata: {
    id: 'PersonaManager',
    version: '1.0.0',
    genesis: { introduced: 'spark' },
    dependencies: ['Utils', 'VFS', 'EventBus?'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { Utils, VFS, EventBus } = deps;
    const { logger } = Utils;
    const getBootMode = () => {
      if (typeof window !== 'undefined' && typeof window.getReploidMode === 'function') {
        return window.getReploidMode();
      }
      return getReploidStorage().getItem('REPLOID_MODE') || 'reploid';
    };

    const CORE_INSTRUCTIONS = `You are REPLOID, a browser-hosted Recursive GEPA Ring agent running inside a same-origin browser substrate.
Your live self is explicit and file-backed. In the self-owned runtime, /self is canonical. In the full substrate runtime, the VFS root exposes /core/, /capabilities/, /tools/, /ui/, and /styles/. Treat these as browser VFS roots, not host operating-system paths.

## VFS BASICS
- Read before writing. List roots before assuming a path exists.
- Memory lives under /.memory (not .memories).
- Styles live under /styles/ (use /styles/rd.css, /styles/boot.css, /styles/proto/index.css).
- UI panels live under /ui/panels/ (list the directory before assuming names).

## BROWSER ECOSYSTEM MODEL
- The browser is the ecosystem: a same-origin lab enclosure with persistent VFS state, visual runtime, local compute lanes, and peer coordination.
- A terminal exposes host shell power. Reploid's browser substrate exposes bounded self-mutation, inspectable UI, rollback-friendly storage, permission-mediated APIs, and browser-to-browser peer slots.
- IndexedDB stores live self, memory, traces, and code.
- OPFS stores larger artifacts, receipts, checkpoints, and eval payloads when available.
- Service Worker and blob module loading turn VFS files into executable ES modules.
- Web Workers isolate verification, tool execution, local jobs, and parallel candidate work.
- WebGPU, WASM, canvas, and media APIs are browser compute and media surfaces when capabilities exist.
- WebRTC, BroadcastChannel, and WebSocket paths are peer slots, witnesses, receipts, and coordination channels.
- DOM, CSS, Custom Elements, and Shadow DOM are the operator control surface and observable runtime.
- Clipboard, File System Access, notifications, wake locks, storage estimates, and share flows are permission-mediated browser APIs.
- Verify capability presence before relying on any browser primitive.
- Do not claim raw operating-system filesystem, shell, process, or arbitrary network access. Use visible tools, configured providers, peer slots, and gates.

## RSI PROTOCOL
1. NEVER declare yourself "done" - there is always room for improvement
2. After writing ANY code: LOAD it, EXECUTE it, VERIFY it works
3. After creating a tool: CALL the tool and observe the output
4. If something fails: debug, fix, retry
5. If something works: look for optimizations, edge cases, enhancements
6. Default to Shadow for self changes: write evidence, receipts, rollback notes, and gate state before promotion.

## TOOL WRITING
All tools live in /tools/. Tools receive a \`deps\` object: { VFS, EventBus, ToolRunner, ... }
- Tool signature: \`export default async function(args, deps) { return result; }\`
- Tool names MUST use CamelCase (e.g., ReadFile, InspectCore)
- Blob-loaded tools must use injected deps instead of relative imports`;

    const ZERO_CORE_INSTRUCTIONS = `You are Zero, a browser-local tabula-rasa RSI agent running inside a same-origin browser substrate.
Your live self starts from a small VFS, one configured model path, a small tool surface, and a shadow/promotion boundary.

## VFS BASICS
- Read before writing. List roots before assuming a path exists.
- Use /self for the active seed, /shadow for candidates, and /artifacts for evidence.
- Do not write durable runtime changes directly into /self.

## ZERO ECOSYSTEM MODEL
- Zero is self-contained in this browser.
- Do not use peer slots, WebRTC witnesses, swarm routing, remote hosts, or pool jobs.
- IndexedDB stores live files, memory, traces, and code.
- OPFS stores larger local artifacts when available.
- Service Worker and blob module loading turn VFS files into executable ES modules.
- Web Workers, WebGPU, WASM, canvas, DOM, CSS, Custom Elements, and Shadow DOM are local browser primitives.
- Permission-mediated APIs require explicit user-facing gates.
- Do not claim raw operating-system filesystem, shell, process, or arbitrary network access.

## RSI PROTOCOL
1. Work in Shadow for self changes.
2. Write evidence and rollback notes before requesting promotion.
3. After writing code: load it, execute it, verify it.
4. If something fails: record the failure boundary, stage a smaller repair, retry.
5. If something works: look for the smallest measurable improvement.

## TOOL WRITING
The kernel tool surface is ReadFile, WriteFile, LoadModule, and Promote.
Create new tools by writing candidates under /shadow/tools, recording evidence under /artifacts, then requesting Promote.`;

    let _config = null;
    let _overrides = null;
    const OVERRIDES_PATH = '/.memory/persona-overrides.json';

    const loadConfig = async () => {
      if (_config) return _config;
      try {
        const response = await fetch('/personas/config.json');
        if (response.ok) {
          _config = await response.json();
        }
      } catch (err) {
        logger.warn('[PersonaManager] Could not load config.json');
      }
      return _config;
    };

    const loadOverrides = async () => {
      if (_overrides) return _overrides;
      _overrides = { personas: {}, updatedAt: Date.now() };
      if (!VFS) return _overrides;
      try {
        if (await VFS.exists(OVERRIDES_PATH)) {
          const content = await VFS.read(OVERRIDES_PATH);
          const parsed = JSON.parse(content);
          _overrides = {
            personas: parsed?.personas || {},
            updatedAt: parsed?.updatedAt || Date.now()
          };
        }
      } catch (err) {
        logger.warn('[PersonaManager] Failed to load overrides', err.message);
      }
      return _overrides;
    };

    const saveOverrides = async () => {
      if (!VFS || !_overrides) return false;
      _overrides.updatedAt = Date.now();
      await VFS.write(OVERRIDES_PATH, JSON.stringify(_overrides, null, 2));
      if (EventBus) {
        EventBus.emit('persona:overrides_updated', { updatedAt: _overrides.updatedAt });
      }
      return true;
    };

    const getActivePersonaId = (config) => {
      return getReploidStorage().getItem('REPLOID_PERSONA_ID')
        || config.defaultPersona
        || 'default';
    };

    const buildSystemPrompt = (personaDef, override = {}) => {
      const coreInstructions = getBootMode() === 'zero' ? ZERO_CORE_INSTRUCTIONS : CORE_INSTRUCTIONS;
      if (!personaDef) return coreInstructions;
      const description = override.description || personaDef.description;
      const instructions = override.instructions || personaDef.instructions || 'Focus on continuous improvement.';
      return `${coreInstructions}

## PERSONA: ${personaDef.name}
${description}

## BEHAVIORAL FOCUS
${instructions}`;
    };

    const getSystemPrompt = async () => {
      try {
        const config = await loadConfig();
        if (!config?.personas?.length) {
          return CORE_INSTRUCTIONS;
        }

        // Get selection from localStorage, fallback to config default
        const selectedId = getActivePersonaId(config);

        const personaDef = config.personas.find(p => p.id === selectedId);
        if (!personaDef) {
          return CORE_INSTRUCTIONS;
        }

        const overrides = await loadOverrides();
        const personaOverride = overrides?.personas?.[selectedId] || {};

        logger.info(`[PersonaManager] Active Persona: ${personaDef.name}`);

        return buildSystemPrompt(personaDef, personaOverride);

      } catch (err) {
        logger.error('[PersonaManager] Failed to load persona', err);
        return CORE_INSTRUCTIONS;
      }
    };

    const getPersonas = async () => {
      const config = await loadConfig();
      return config?.personas || [];
    };

    const getActivePersona = async () => {
      const config = await loadConfig();
      const personaId = getActivePersonaId(config || {});
      const personaDef = config?.personas?.find(p => p.id === personaId) || null;
      const overrides = await loadOverrides();
      const personaOverride = overrides?.personas?.[personaId] || {};
      if (!personaDef) return null;
      return {
        ...personaDef,
        description: personaOverride.description || personaDef.description,
        instructions: personaOverride.instructions || personaDef.instructions
      };
    };

    const getPromptSlots = async (personaId = null) => {
      const config = await loadConfig();
      const resolvedId = personaId || getActivePersonaId(config || {});
      const personaDef = config?.personas?.find(p => p.id === resolvedId) || null;
      const overrides = await loadOverrides();
      const personaOverride = overrides?.personas?.[resolvedId] || {};
      return {
        coreInstructions: CORE_INSTRUCTIONS,
        personaId: resolvedId,
        personaName: personaDef?.name || null,
        description: personaOverride.description || personaDef?.description || '',
        instructions: personaOverride.instructions || personaDef?.instructions || ''
      };
    };

    const applySlotMutation = async ({ personaId, slot, content, mode = 'replace' }) => {
      if (!personaId || !slot) {
        throw new Error('personaId and slot required');
      }
      if (!['description', 'instructions'].includes(slot)) {
        throw new Error(`Unsupported slot: ${slot}`);
      }
      const overrides = await loadOverrides();
      const current = overrides.personas[personaId]?.[slot] || '';
      let next = content;
      if (mode === 'append') next = `${current}\n${content}`.trim();
      if (mode === 'prepend') next = `${content}\n${current}`.trim();
      overrides.personas[personaId] = {
        ...overrides.personas[personaId],
        [slot]: next
      };
      await saveOverrides();
      return { personaId, slot, content: next };
    };

    return { getSystemPrompt, getPersonas, getActivePersona, getPromptSlots, applySlotMutation, buildSystemPrompt };
  }
};

export default PersonaManager;
