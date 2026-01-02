# Blueprint 0x000095: Hot-Swappable Neural Compiler

**Objective:** Define an architecture that treats a small LLM (FunctionGemma 270M) as a dynamic instruction set with hot-swappable LoRA adapters, enabling specialized code generation without full model reloading.

**Target Upgrade:** HSNC (`neural-compiler.js`)

**Prerequisites:**
- 0x000007 (LLM Client Architecture)
- 0x000075 (Arena Harness)
- 0x000048 (Module Widget Protocol)
- 0x00004B (Semantic Memory)

**Affected Artifacts:** `/capabilities/intelligence/neural-compiler.js`, `/core/llm-client.js`, `/capabilities/validation/ui-validator.js`

---

## 1. The Strategic Imperative

Large LLMs are generalists - good at many things, expert at none. Small models (270M parameters) are typically too weak for complex tasks. However, a small model with a **specialized LoRA adapter** can match or exceed large model performance on narrow domains.

The challenge: swapping full models is slow (~2-5s). LoRA adapters are tiny (~2MB) and can be swapped in ~50-100ms. This enables a **pipelined architecture** where the base model stays loaded while adapters hot-swap based on task type.

**Key Insight:** Treat the LLM not as a chatbot but as a **dynamic CPU** where LoRA adapters are the instruction sets.

---

## 2. Architectural Overview

### 2.1 Core Components

```
+------------------+     +-------------------+     +------------------+
|   Main Brain     | --> |   Task Scheduler  | --> |  LoRA Dispatcher |
| (GPT-4o/Claude)  |     | (Batch & Sort)    |     | (Adapter Loader) |
+------------------+     +-------------------+     +------------------+
        |                        |                         |
        v                        v                         v
+------------------+     +-------------------+     +------------------+
| Neural Assembly  |     |  Embedding        |     |  FunctionGemma   |
| Plan (JSON)      |     |  Classifier       |     |  + Active LoRA   |
+------------------+     +-------------------+     +------------------+
                                                           |
                                                           v
                                              +------------------------+
                                              |  Schema Validator +    |
                                              |  Arena Verification    |
                                              +------------------------+
```

### 2.2 Leveraging Existing Infrastructure

| Component | Existing Module | Integration Point |
|-----------|-----------------|-------------------|
| Task classification | `SemanticMemory` (MiniLM-L6-v2) | Embed task → find nearest LoRA |
| Multi-variant testing | `ArenaHarness` | Generate N variants, select best |
| Schema validation | `SchemaRegistry` | Validate JSON outputs |
| Pattern learning | `ReflectionStore` | Record error → fix mappings |
| Context injection | `SemanticMemory.enrich()` | Inject learned patterns |

---

## 3. Implementation Pathway

### Phase 1: Pipelined LoRA Execution

**Problem:** Linear LoRA swaps cause latency thrashing.

**Solution:** Batch tasks by adapter type, minimize swaps.

```javascript
// neural-compiler.js
const NeuralCompiler = {
  metadata: {
    id: 'NeuralCompiler',
    version: '1.0.0',
    dependencies: ['LLMClient', 'SemanticMemory', 'SchemaRegistry', 'ArenaHarness'],
    type: 'capability'
  },

  factory: (deps) => {
    const { LLMClient, SemanticMemory, SchemaRegistry, ArenaHarness } = deps;

    // LoRA adapter registry
    const _loraRegistry = new Map(); // adapterName → { path, embedding, metadata }
    let _activeLoRA = null;
    let _baseModelLoaded = false;

    // Batch tasks by adapter type to minimize swaps
    const scheduleTasks = async (tasks) => {
      // 1. Classify each task using embedding similarity
      const classified = await Promise.all(tasks.map(async (task) => {
        const taskEmbed = await SemanticMemory.embed(task.description);
        const bestAdapter = findNearestAdapter(taskEmbed);
        return { ...task, adapter: bestAdapter.name, score: bestAdapter.score };
      }));

      // 2. Group by adapter type
      const batches = new Map();
      for (const task of classified) {
        if (!batches.has(task.adapter)) batches.set(task.adapter, []);
        batches.get(task.adapter).push(task);
      }

      // 3. Execute in batched order (minimizes swaps)
      const results = [];
      for (const [adapterName, batch] of batches) {
        await loadLoRA(adapterName);
        for (const task of batch) {
          const result = await executeTask(task);
          results.push({ taskId: task.id, result });
        }
      }

      return results;
    };

    const findNearestAdapter = (queryEmbed) => {
      let best = { name: 'default', score: 0 };
      for (const [name, adapter] of _loraRegistry) {
        const score = cosineSimilarity(queryEmbed, adapter.embedding);
        if (score > best.score) best = { name, score };
      }
      return best;
    };

    const loadLoRA = async (adapterName) => {
      if (_activeLoRA === adapterName) return; // Already loaded

      const adapter = _loraRegistry.get(adapterName);
      if (!adapter) throw new Error(`Unknown adapter: ${adapterName}`);

      // Load via DOPPLER provider (requires kernel support)
      await LLMClient.loadLoRAAdapter(adapter.path);
      _activeLoRA = adapterName;
    };

    return {
      api: {
        registerAdapter: (name, path, metadata) => { /* ... */ },
        scheduleTasks,
        executeTask,
        getActiveLoRA: () => _activeLoRA
      },
      widget: { /* ... */ }
    };
  }
};
```

### Phase 2: Schema-Driven Generation

**Problem:** LLMs hallucinate syntax and structure.

**Solution:** Use JSON Schema to constrain outputs, validate before use.

```javascript
// Template interface using SchemaRegistry
const defineTemplate = async (templateName, schema, templateCode) => {
  // Register schema with SchemaRegistry
  await SchemaRegistry.registerToolSchema(templateName, {
    description: `Fill template: ${templateName}`,
    parameters: schema
  });

  // Store template code
  await VFS.write(`/.templates/${templateName}.hbs`, templateCode);
};

// Example: Login form template
await defineTemplate('login_form', {
  type: 'object',
  required: ['auth_url', 'error_message'],
  properties: {
    auth_url: { type: 'string', format: 'uri' },
    error_message: { type: 'string', maxLength: 100 },
    retry_count: { type: 'integer', minimum: 1, maximum: 5 }
  }
}, `
<form action="{{auth_url}}" method="POST">
  <input type="text" name="username" required />
  <input type="password" name="password" required />
  {{#if error_message}}
    <div class="error">{{error_message}}</div>
  {{/if}}
  <button type="submit">Login</button>
</form>
`);

// Execution: FunctionGemma fills the schema
const fillTemplate = async (templateName, context) => {
  const schema = await SchemaRegistry.getToolSchema(templateName);

  // Prompt FunctionGemma to generate JSON matching schema
  const prompt = `Call function "${templateName}" with appropriate values.
Context: ${context}
Schema: ${JSON.stringify(schema.parameters)}`;

  const response = await LLMClient.chat([{ role: 'user', content: prompt }]);
  const params = JSON.parse(response.content);

  // Validate against schema (throws on failure)
  SchemaRegistry.validate(templateName, params);

  // Apply to template
  const template = await VFS.read(`/.templates/${templateName}.hbs`);
  return Handlebars.compile(template)(params);
};
```

### Phase 3: Constraint-Based UI Sampling

**Problem:** Generated UI may break layout or fail accessibility.

**Solution:** Use rejection sampling with DOM validation.

```javascript
// ui-validator.js
const UIValidator = {
  metadata: {
    id: 'UIValidator',
    version: '1.0.0',
    dependencies: ['ArenaHarness'],
    type: 'capability'
  },

  factory: (deps) => {
    const { ArenaHarness } = deps;

    // Create sandboxed iframe for rendering
    const createSandbox = () => {
      const iframe = document.createElement('iframe');
      iframe.sandbox = 'allow-scripts';
      iframe.style.cssText = 'position:absolute;left:-9999px;width:1024px;height:768px;';
      document.body.appendChild(iframe);
      return iframe;
    };

    // Validate rendered UI against constraints
    const validateUI = async (html, css) => {
      const sandbox = createSandbox();
      const violations = [];

      try {
        // Inject content
        sandbox.contentDocument.write(`
          <style>${css}</style>
          ${html}
        `);
        sandbox.contentDocument.close();

        // Wait for render
        await new Promise(r => setTimeout(r, 100));

        const doc = sandbox.contentDocument;

        // Check 1: No horizontal overflow
        const body = doc.body;
        if (body.scrollWidth > sandbox.clientWidth) {
          violations.push({ type: 'overflow', message: 'Horizontal overflow detected' });
        }

        // Check 2: Contrast ratios (simplified WCAG AA check)
        const elements = doc.querySelectorAll('*');
        for (const el of elements) {
          const style = sandbox.contentWindow.getComputedStyle(el);
          const contrast = calculateContrast(style.color, style.backgroundColor);
          if (contrast < 4.5) {
            violations.push({
              type: 'contrast',
              element: el.tagName,
              contrast,
              message: `Low contrast: ${contrast.toFixed(2)} (min 4.5)`
            });
          }
        }

        // Check 3: Interactive elements have accessible names
        const interactives = doc.querySelectorAll('button, a, input, select, textarea');
        for (const el of interactives) {
          const name = el.getAttribute('aria-label') ||
                       el.getAttribute('title') ||
                       el.textContent?.trim();
          if (!name) {
            violations.push({
              type: 'accessibility',
              element: el.tagName,
              message: 'Missing accessible name'
            });
          }
        }

      } finally {
        sandbox.remove();
      }

      return {
        valid: violations.length === 0,
        violations,
        score: 1 - (violations.length / 10) // Normalized score
      };
    };

    // Generate N variants, return best passing one
    const sampleUI = async (prompt, count = 5) => {
      const variants = await Promise.all(
        Array(count).fill(null).map(() =>
          LLMClient.chat([{ role: 'user', content: prompt }])
        )
      );

      const results = await Promise.all(
        variants.map(async (v) => {
          const { html, css } = parseUIResponse(v.content);
          const validation = await validateUI(html, css);
          return { html, css, validation };
        })
      );

      // Return first valid, or least violations
      const valid = results.find(r => r.validation.valid);
      if (valid) return valid;

      return results.sort((a, b) =>
        a.validation.violations.length - b.validation.violations.length
      )[0];
    };

    return {
      api: { validateUI, sampleUI },
      widget: { /* ... */ }
    };
  }
};
```

### Phase 4: RAG-Based Pattern Patching

**Problem:** Browser security policies cause runtime errors that require specific fixes.

**Solution:** Store error → fix mappings, inject as context on retry.

```javascript
// Extend ReflectionStore with proven patterns
const ProvenPatterns = {
  // Store: errorSignature → { fix, successCount, lastUsed }
  _patterns: new Map(),

  async recordFix(errorSignature, fix, context) {
    const key = this.normalizeSignature(errorSignature);
    const existing = this._patterns.get(key) || { fix, successCount: 0, lastUsed: 0 };

    existing.successCount++;
    existing.lastUsed = Date.now();
    existing.fix = fix; // Update with latest working fix

    this._patterns.set(key, existing);
    await this.persist();
  },

  async getFix(errorSignature) {
    const key = this.normalizeSignature(errorSignature);
    return this._patterns.get(key)?.fix || null;
  },

  normalizeSignature(error) {
    // Extract error type and key identifying info
    // "DOMException: play() failed because the user didn't interact"
    // → "DOMException:play:user-gesture"
    const match = error.match(/^(\w+Exception?):\s*(.+)/);
    if (!match) return error.slice(0, 100);

    const [, type, message] = match;
    const keywords = message.match(/\b(play|audio|gesture|permission|secure|https)\b/gi) || [];
    return `${type}:${keywords.join(':')}`.toLowerCase();
  },

  async injectPatternContext(prompt, errorHistory) {
    const fixes = [];

    for (const error of errorHistory) {
      const fix = await this.getFix(error);
      if (fix) fixes.push(`- Error "${error}" is fixed by: ${fix}`);
    }

    if (fixes.length === 0) return prompt;

    return `${prompt}

IMPORTANT: Previous attempts encountered these errors. Apply the known fixes:
${fixes.join('\n')}`;
  }
};

// Integration with agent loop
const executeWithRetry = async (task, maxRetries = 3) => {
  const errorHistory = [];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Inject known fixes into prompt
      const enrichedPrompt = await ProvenPatterns.injectPatternContext(
        task.prompt,
        errorHistory
      );

      const result = await NeuralCompiler.executeTask({
        ...task,
        prompt: enrichedPrompt
      });

      // Success! Record if this was a retry
      if (errorHistory.length > 0) {
        await ProvenPatterns.recordFix(
          errorHistory[errorHistory.length - 1],
          `Use pattern from successful attempt: ${extractPattern(result)}`
        );
      }

      return result;

    } catch (error) {
      errorHistory.push(error.message);

      // Check if we have a known fix
      const knownFix = await ProvenPatterns.getFix(error.message);
      if (knownFix) {
        console.log(`[HSNC] Applying known fix: ${knownFix}`);
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${errorHistory.join(', ')}`);
};
```

---

## 4. LoRA Adapter Management

### 4.1 Adapter Format

```javascript
// LoRA adapter manifest
{
  "name": "react-forms",
  "version": "1.0.0",
  "baseModel": "functiongemma-270m",
  "rank": 16,                    // LoRA rank
  "alpha": 32,                   // LoRA alpha
  "targetModules": ["q_proj", "v_proj", "k_proj", "o_proj"],
  "embedding": [0.12, -0.34, ...], // 384-dim for routing
  "keywords": ["react", "form", "input", "validation"],
  "shardPath": "/.lora/react-forms/weights.bin",
  "sizeBytes": 2097152           // ~2MB
}
```

### 4.2 VFS Storage (Mirror EmbeddingStore Pattern)

```javascript
const LoRACache = {
  CACHE_DIR: '/.cache/lora',

  async init(VFS) {
    this.VFS = VFS;
    const exists = await VFS.exists(this.CACHE_DIR);
    if (!exists) await VFS.mkdir(this.CACHE_DIR);
  },

  async store(manifest, weights) {
    const path = `${this.CACHE_DIR}/${manifest.name}.json`;
    await this.VFS.write(path, JSON.stringify({ ...manifest, weights }));
  },

  async load(name) {
    const path = `${this.CACHE_DIR}/${name}.json`;
    try {
      const content = await this.VFS.read(path);
      return JSON.parse(content);
    } catch {
      return null;
    }
  },

  async list() {
    const files = await this.VFS.list(this.CACHE_DIR);
    return files
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(`${this.CACHE_DIR}/`, '').replace('.json', ''));
  }
};
```

---

## 5. LLMClient Integration

### 5.1 Required Extensions to `/core/llm-client.js`

```javascript
// New methods for DOPPLER provider
const _loadLoRAAdapter = async (adapterPath) => {
  if (!_dopplerProvider) {
    throw new Error('LoRA requires DOPPLER provider');
  }

  // Load adapter weights from IndexedDB or VFS
  const adapter = await LoRACache.load(adapterPath) ||
                  await VFS.read(adapterPath);

  // Merge into base model (requires Doppler kernel support)
  await _dopplerProvider.mergeLoRA(adapter.weights, {
    rank: adapter.rank,
    alpha: adapter.alpha,
    targetModules: adapter.targetModules
  });

  _activeLoRA = adapter.name;
};

const _unloadLoRAAdapter = async () => {
  if (!_dopplerProvider || !_activeLoRA) return;

  // Restore base model weights
  await _dopplerProvider.unmergeLoRA();
  _activeLoRA = null;
};

// Expose in API
return {
  // ... existing methods
  loadLoRAAdapter: _loadLoRAAdapter,
  unloadLoRAAdapter: _unloadLoRAAdapter,
  getActiveLoRA: () => _activeLoRA
};
```

---

## 6. Proto Widget

```javascript
class NeuralCompilerWidget extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    this._interval = setInterval(() => this.render(), 2000);
  }

  disconnectedCallback() {
    if (this._interval) clearInterval(this._interval);
  }

  getStatus() {
    return {
      state: _activeLoRA ? 'active' : 'idle',
      primaryMetric: _activeLoRA || 'No adapter',
      secondaryMetric: `${_loraRegistry.size} adapters`,
      lastActivity: _lastSwapTime,
      message: `${_totalSwaps} swaps, ${_totalTasks} tasks`
    };
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; font-family: monospace; font-size: 12px; }
        .panel { background: #1a1a2e; padding: 12px; border-radius: 4px; }
        .active { color: #0f0; }
        .adapter-list { max-height: 150px; overflow-y: auto; }
        .adapter { padding: 4px; border-bottom: 1px solid #333; }
        .adapter.active { background: rgba(0,255,0,0.1); }
      </style>
      <div class="panel">
        <h4>Neural Compiler</h4>
        <div>Active: <span class="active">${_activeLoRA || 'None'}</span></div>
        <div>Total Swaps: ${_totalSwaps}</div>
        <div>Tasks Executed: ${_totalTasks}</div>
        <h5>Registered Adapters (${_loraRegistry.size})</h5>
        <div class="adapter-list">
          ${Array.from(_loraRegistry.entries()).map(([name, adapter]) => `
            <div class="adapter ${name === _activeLoRA ? 'active' : ''}">
              ${name} (${(adapter.sizeBytes / 1024 / 1024).toFixed(1)}MB)
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

if (!customElements.get('neural-compiler-widget')) {
  customElements.define('neural-compiler-widget', NeuralCompilerWidget);
}

const widget = {
  element: 'neural-compiler-widget',
  displayName: 'Neural Compiler',
  icon: '⚡',
  category: 'intelligence',
  order: 50
};
```

---

## 7. Implementation Phases

### Phase 1: No LoRA (Use Existing Infrastructure)
- [x] Task scheduling with embedding-based routing (SemanticMemory)
- [x] Schema-driven generation (SchemaRegistry)
- [x] Multi-variant sampling (ArenaHarness)
- [x] Pattern RAG (ReflectionStore + SemanticMemory.enrich)

### Phase 2: UI Validation
- [ ] Create `/capabilities/validation/ui-validator.js`
- [ ] Sandboxed iframe renderer
- [ ] WCAG contrast checks
- [ ] Overflow detection
- [ ] Wire into Arena scoring

### Phase 3: LoRA Infrastructure
- [ ] LoRA adapter manifest format
- [ ] IndexedDB LoRA cache
- [ ] LLMClient.loadLoRAAdapter() / unloadLoRAAdapter()
- [ ] Doppler kernel: weight merging support

### Phase 4: Full Integration
- [ ] NeuralCompiler module with batched scheduling
- [ ] Adapter auto-download from registry
- [ ] Performance benchmarks (swap latency, task throughput)
- [ ] Proto widget

---

## 8. Success Criteria

| Metric | Target |
|--------|--------|
| LoRA swap latency | <100ms |
| Task batch efficiency | >70% tasks per swap |
| Schema validation pass rate | >95% |
| UI validation pass rate | >80% first attempt |
| Pattern reuse rate | >50% on retries |

---

## 9. Security Considerations

1. **LoRA Source Validation**: Only load adapters from trusted sources or with verified signatures
2. **Sandbox Isolation**: UI validation uses `sandbox="allow-scripts"` (no cookies, storage, or top-navigation)
3. **Schema Enforcement**: All LLM outputs validated before use
4. **Pattern Injection Sanitization**: Ensure injected patterns don't contain prompt injection attacks

---

## 10. Future Evolution

1. **Adapter Fine-Tuning**: In-browser LoRA training on user patterns
2. **Adapter Composition**: Merge multiple LoRAs for multi-domain tasks
3. **Federated Adapters**: Share proven adapters across REPLOID instances
4. **WGSL Optimization**: Apply same pattern to WebGPU kernel generation

---

**Remember:** The key insight is treating the LLM as a **programmable instruction set** rather than a monolithic chatbot. LoRA adapters are the "microcode" that specializes the processor for different tasks.
