# REPLOID Enhancement TODO Checklist

**Generated:** 2025-10-01
**Analysis Depth:** Comprehensive deep dive of 15+ core modules (~8,000 LOC)
**Status:** Ready for implementation

---

## 📋 Overview

This TODO list represents a comprehensive analysis of REPLOID's codebase to identify enhancements that will make the system more powerful and better aligned with its Recursive Self-Improvement (RSI) goals. All items are prioritized by impact and effort.

**Key Finding:** The HybridLLMProvider (AR-2) was implemented but **NOT integrated** into the agent cycle. This is the #1 blocker preventing local inference from working.

---

## 🚨 P0: CRITICAL BLOCKERS (Must Fix Immediately)

These are show-stoppers that prevent core functionality from working or represent significant technical debt.

### ✅ 1. Wire HybridLLMProvider into Agent Execution Loops

**Status:** COMPLETED
**Priority:** CRITICAL
**Effort:** Low (2-3 hours)
**Impact:** Massive - Unlocks entire AR-2 local inference feature

**Problem:**
The HybridLLMProvider module was created in AR-2 to enable local WebGPU inference, but the agent execution loops still use the old `ApiClient` directly. This means:
- Local LLM is only accessible via UI testing
- Agent cannot benefit from zero-cost local inference
- Hybrid fallback mechanism is unused
- AR-2 completion is incomplete

**Files to Modify:**
1. `upgrades/agent-cycle.js` - Line 320 (within `agentActionPlanWithContext`)
2. `upgrades/sentinel-fsm.js` - Line 320 (within `executeGeneratingProposal`)

**Current Code (agent-cycle.js:320):**
```javascript
const response = await ApiClient.sendMessage([{
  role: 'system',
  content: 'You are a Guardian Agent...'
}, {
  role: 'user',
  content: planPrompt
}]);
```

**Replacement Strategy:**
```javascript
// Get HybridLLMProvider from DI container
const HybridLLM = DIContainer.get('HybridLLMProvider');

// Use hybrid provider with automatic fallback
const response = await HybridLLM.complete([{
  role: 'system',
  content: 'You are a Guardian Agent...'
}, {
  role: 'user',
  content: planPrompt
}], {
  temperature: 0.7,
  maxOutputTokens: 8192
});

// response.text contains the completion
const content = response.text;
```

**Additional Changes Needed:**
- Update `config.json` to ensure HYBR is in `defaultCore` (already done)
- Update agent-cycle.js initialization to get HybridLLMProvider from DI container
- Update sentinel-fsm.js initialization similarly
- Test both local and cloud modes
- Verify automatic fallback when local fails

**Testing Checklist:**
- [ ] Agent can complete cycle using local LLM (Qwen2.5 Coder)
- [ ] Agent falls back to cloud when local LLM unloaded
- [ ] Streaming works for local mode
- [ ] Non-streaming works for cloud mode
- [ ] HybridLLM events are emitted correctly
- [ ] Performance metrics show which mode was used

**Success Criteria:**
- Agent completes full cycle using local inference
- Dashboard shows "local" as provider in status
- Zero API costs when using local mode
- Automatic fallback to cloud if local fails

---

### ✅ 2. Register Python Execution Tools with Agent

**Status:** COMPLETED
**Priority:** CRITICAL
**Effort:** Low (1-2 hours)
**Impact:** High - Enables Python/NumPy/SciPy for RSI

**Problem:**
The Python execution capability exists via PyodideRuntime and python-tool.js, but may not be registered in the agent's tool catalog. If the `execute_python` tool isn't available, the agent cannot use Python for computations, data analysis, or self-improvement tasks.

**Files to Check:**
1. `upgrades/python-tool.js` - Tool implementation exists
2. `upgrades/tools-write.json` - Check if `execute_python` is listed
3. `upgrades/tool-runner.js` - Verify dynamic tool registration
4. `boot.js` - Check if PyodideRuntime is initialized before agent starts

**Investigation Steps:**
1. Open `upgrades/tools-write.json`
2. Search for `execute_python` tool declaration
3. If missing, add tool declaration:

```json
{
  "name": "execute_python",
  "description": "Execute Python code using the in-browser Pyodide runtime. Supports NumPy, SciPy, pandas, and other scientific libraries. Use this for mathematical computations, data analysis, or algorithmic tasks.",
  "parameters": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "Python code to execute. Must be valid Python 3.11 syntax."
      },
      "install_packages": {
        "type": "array",
        "items": { "type": "string" },
        "description": "List of Python packages to install from PyPI before execution (e.g., ['numpy', 'scipy'])"
      },
      "sync_workspace": {
        "type": "boolean",
        "description": "Whether to sync the VFS workspace to Pyodide filesystem before execution"
      }
    },
    "required": ["code"]
  }
}
```

**Implementation in tool-runner.js:**
If not already present, add case to the switch statement:

```javascript
case "execute_python": {
  const PythonTool = injectedDependencies?.PythonTool;
  if (!PythonTool) {
    throw new ToolError("Python tool not available");
  }
  const result = await PythonTool.executePython(toolArgs);
  return result;
}
```

**Testing Checklist:**
- [ ] Agent can see `execute_python` in tool catalog
- [ ] Agent can execute simple Python: `print("Hello from Python")`
- [ ] Agent can use NumPy: `import numpy as np; np.array([1,2,3])`
- [ ] Agent can install packages dynamically
- [ ] Workspace sync works (VFS files accessible in Python)
- [ ] Python errors are caught and returned gracefully

**Success Criteria:**
- `execute_python` appears in introspector's tool catalog
- Agent uses Python for mathematical tasks in cycle
- No errors when executing Python code

---

### ✅ 3. Fix Git VFS Variable Inconsistencies

**Status:** COMPLETED
**Priority:** CRITICAL
**Effort:** Low (30 minutes)
**Impact:** High - Fixes broken history/diff features

**Problem:**
The Git VFS module has inconsistent variable usage that will cause crashes:
- Uses `fs` instead of `pfs` (PromiseFS) in several functions
- Uses `repoDir` instead of `REPO_DIR` constant
- Code at lines 278, 290, 326, 346 will fail with "fs is not defined"

**Files to Fix:**
- `upgrades/git-vfs.js`

**Specific Fixes:**

**Line 278 (in getCommitChanges):**
```javascript
// BEFORE (BROKEN):
const commit = await git.readCommit({ fs, dir: repoDir, oid: sha });

// AFTER (FIXED):
const commit = await git.readCommit({ fs: pfs, dir: REPO_DIR, oid: sha });
```

**Line 290 (in getCommitChanges):**
```javascript
// BEFORE (BROKEN):
const parentCommit = await git.readCommit({ fs, dir: repoDir, oid: parents[0] });

// AFTER (FIXED):
const parentCommit = await git.readCommit({ fs: pfs, dir: REPO_DIR, oid: parents[0] });
```

**Line 326 (in getAllFilesInTree):**
```javascript
// BEFORE (BROKEN):
const { tree } = await git.readTree({ fs, dir: repoDir, oid: treeOid });

// AFTER (FIXED):
const { tree } = await git.readTree({ fs: pfs, dir: REPO_DIR, oid: treeOid });
```

**Line 346 (in getTreeFiles):**
```javascript
// BEFORE (BROKEN):
const { tree } = await git.readTree({ fs, dir: repoDir, oid: treeOid });

// AFTER (FIXED):
const { tree } = await git.readTree({ fs: pfs, dir: REPO_DIR, oid: treeOid });
```

**Testing Checklist:**
- [ ] `GitVFS.getHistory('/vfs/test.js')` doesn't crash
- [ ] `GitVFS.getDiff('/vfs/test.js')` shows proper line-by-line diff
- [ ] `GitVFS.getCommitChanges(sha)` returns file changes
- [ ] Checkpoint creation works
- [ ] Checkpoint restoration works

**Success Criteria:**
- No "fs is not defined" errors
- History and diff features work correctly
- All Git VFS tests pass

---

## ⚡ P1: HIGH IMPACT (Major RSI Enhancements)

These significantly enhance REPLOID's recursive self-improvement capabilities.

### ✅ 4. Enable Multi-Agent Swarm Intelligence

**Status:** COMPLETED
**Priority:** HIGH
**Effort:** High (8-12 hours)
**Impact:** MASSIVE - Enables distributed RSI across multiple agent instances

**Vision:**
Transform REPLOID from a single-agent system to a swarm intelligence system where multiple agent instances can:
- **Delegate subtasks** to specialized peers
- **Share knowledge** about successful modifications
- **Request consensus** before making risky changes
- **Pool computational resources** for parallel work
- **Learn collectively** from each other's reflections

**Current State:**
- WebRTC swarm infrastructure exists (`webrtc-swarm.js` - 698 lines)
- BroadcastChannel signaling works
- Peer discovery and data channels functional
- **BUT:** No agent actually uses the swarm API

**Architecture Design:**

Create new `upgrades/swarm-orchestrator.js`:
```javascript
const SwarmOrchestrator = {
  metadata: {
    id: 'SwarmOrchestrator',
    version: '1.0.0',
    dependencies: ['WebRTCSwarm', 'StateManager', 'ReflectionStore', 'EventBus'],
    type: 'service'
  },

  factory: (deps) => {
    const { WebRTCSwarm, StateManager, ReflectionStore, EventBus } = deps;

    // Register agent capabilities with swarm
    const registerCapabilities = async () => {
      const capabilities = [
        'code-generation',
        'python-execution',
        'local-llm',
        'git-vfs'
      ];
      WebRTCSwarm.updateCapabilities(capabilities);
    };

    // Delegate heavy computation to peers
    const delegateComputation = async (taskType, taskData) => {
      const task = {
        name: taskType,
        requirements: ['python-execution'],
        data: taskData
      };
      return await WebRTCSwarm.delegateTask(task);
    };

    // Share successful reflection with swarm
    const shareSuccessPattern = async (reflection) => {
      if (reflection.outcome === 'successful') {
        const artifactId = `/reflections/success-${Date.now()}.json`;
        await StateManager.createArtifact(
          artifactId,
          'json',
          JSON.stringify(reflection),
          'Successful pattern'
        );
        await WebRTCSwarm.shareKnowledge(artifactId);
      }
    };

    // Request consensus for risky modifications
    const requestModificationConsensus = async (modification) => {
      const proposal = {
        type: 'code-modification',
        content: modification.code,
        target: modification.filePath,
        rationale: modification.reason
      };

      const result = await WebRTCSwarm.requestConsensus(proposal, 30000);
      return result.consensus;
    };

    return {
      registerCapabilities,
      delegateComputation,
      shareSuccessPattern,
      requestModificationConsensus
    };
  }
};
```

**Integration Points:**

1. **Agent Cycle Integration** (`agent-cycle.js`):
   - Before applying changes: Request consensus from swarm
   - After successful cycle: Share reflection with peers
   - During computation: Delegate Python tasks to peers

2. **Reflection Integration** (`sentinel-fsm.js:523`):
   ```javascript
   // After storing reflection locally
   if (reflectionData.outcome === 'successful') {
     const SwarmOrch = DIContainer.get('SwarmOrchestrator');
     await SwarmOrch.shareSuccessPattern(reflectionData);
   }
   ```

3. **Capability Registration** (`boot.js`):
   ```javascript
   // After agent initialization
   const SwarmOrch = DIContainer.get('SwarmOrchestrator');
   await SwarmOrch.registerCapabilities();
   ```

**Use Cases:**

**Use Case 1: Distributed Code Generation**
```
Agent A: Needs to generate 5 test files
Action: Delegates 3 files to Agents B, C, D
Result: 5x faster completion via parallel generation
```

**Use Case 2: Collective Learning**
```
Agent A: Discovers that "breaking changes into atomic commits" improves success rate
Action: Shares reflection with swarm
Result: Agents B, C, D adopt the same strategy
```

**Use Case 3: Risk Mitigation**
```
Agent A: Wants to modify core agent-cycle.js file
Action: Requests consensus from swarm (needs >50% approval)
Result: 3/5 agents approve → modification proceeds safely
```

**Testing Checklist:**
- [ ] Open 3 browser tabs with REPLOID
- [ ] All 3 agents discover each other via BroadcastChannel
- [ ] Agent 1 delegates task to Agent 2
- [ ] Agent 2 executes task and returns result
- [ ] Agent 1 shares reflection, Agents 2-3 receive it
- [ ] Agent 1 requests consensus, Agents 2-3 vote
- [ ] Swarm stats show 3 connected peers

**Success Criteria:**
- Multiple agents can communicate via WebRTC
- Task delegation works end-to-end
- Knowledge sharing distributes reflections
- Consensus mechanism prevents bad modifications
- Swarm gracefully handles peer disconnections

---

### ✅ 5. Add Streaming Support for Cloud LLM

**Status:** COMPLETED
**Priority:** HIGH
**Effort:** Medium (3-4 hours)
**Impact:** Medium - Better UX and early error detection

**Problem:**
The HybridLLMProvider's `stream()` function (lines 212-246) only supports streaming for local LLM. When in cloud mode, it falls back to non-streaming completion and yields the entire response at once. This results in:
- Poor UX (no progressive output)
- Cannot detect errors early
- Inconsistent behavior between local/cloud modes

**Files to Modify:**
- `upgrades/hybrid-llm-provider.js` (lines 234-244)
- `upgrades/api-client-multi.js` (add streaming support)

**Current Code (hybrid-llm-provider.js:234-244):**
```javascript
} else {
  // Cloud doesn't support streaming in this implementation
  // Fall back to non-streaming
  const result = await completeCloud(messages, options);

  yield {
    delta: result.text,
    text: result.text,
    done: true,
    provider: 'cloud'
  };
}
```

**Replacement Strategy:**

1. **Add streaming to api-client-multi.js:**
```javascript
const generateContentStream = async function* (config) {
  const provider = getProvider();

  if (provider === 'gemini') {
    const response = await getModelForProvider().generateContentStream({
      contents: config.contents,
      generationConfig: config.generationConfig
    });

    let fullText = '';
    for await (const chunk of response.stream) {
      const delta = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
      fullText += delta;

      yield {
        delta,
        text: fullText,
        done: false
      };
    }

    const finalResponse = await response.response;
    yield {
      delta: '',
      text: fullText,
      done: true,
      usage: finalResponse.usageMetadata
    };
  } else {
    // Fallback for OpenAI, Anthropic (implement similarly)
    const response = await generateContent(config);
    yield {
      delta: response.text,
      text: response.text,
      done: true,
      usage: response.usage
    };
  }
};
```

2. **Update HybridLLMProvider.stream():**
```javascript
} else {
  // Cloud streaming via ApiClient
  const streamGen = await cloudAPIClient.generateContentStream({
    contents: messages.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    })),
    generationConfig: {
      temperature: options.temperature || 0.7,
      maxOutputTokens: options.maxOutputTokens || 8192
    }
  });

  for await (const chunk of streamGen) {
    yield {
      delta: chunk.delta,
      text: chunk.text,
      done: chunk.done,
      provider: 'cloud',
      usage: chunk.usage
    };
  }
}
```

**Testing Checklist:**
- [ ] Cloud streaming yields progressive chunks
- [ ] Final chunk includes usage metadata
- [ ] Error during streaming is caught and propagated
- [ ] UI shows real-time output (not all at once)
- [ ] Streaming works for Gemini provider
- [ ] Fallback to non-streaming works for unsupported providers

**Success Criteria:**
- Cloud mode streams tokens progressively
- Consistent streaming behavior between local/cloud
- Early error detection (no waiting for full response)

---

### ✅ 6. Implement Reflection Pattern Recognition

**Status:** COMPLETED
**Priority:** HIGH
**Effort:** Medium (4-6 hours)
**Impact:** High - Agent learns from past mistakes more effectively

**Vision:**
Transform the reflection system from passive storage to active learning by:
- **Clustering** similar reflections to identify patterns
- **Detecting** recurring failure modes
- **Recommending** solutions based on past successes
- **Trending** which strategies work best over time

**Current State:**
- Reflections are stored in IndexedDB (`reflection-store.js`)
- Indexed by timestamp, outcome, category, session, tags
- **BUT:** No pattern analysis or recommendation engine

**Architecture Design:**

Create new `upgrades/reflection-analyzer.js`:
```javascript
const ReflectionAnalyzer = {
  metadata: {
    id: 'ReflectionAnalyzer',
    version: '1.0.0',
    dependencies: ['ReflectionStore', 'Utils'],
    type: 'intelligence'
  },

  factory: (deps) => {
    const { ReflectionStore, Utils } = deps;
    const { logger } = Utils;

    /**
     * Cluster reflections by similarity
     * Uses simple Jaccard similarity on tags/keywords
     */
    const clusterReflections = async (minClusterSize = 3) => {
      const allReflections = await ReflectionStore.getReflections();
      const clusters = [];

      // Extract keywords from descriptions
      const getKeywords = (text) => {
        return text.toLowerCase()
          .split(/\W+/)
          .filter(w => w.length > 3)
          .slice(0, 10);
      };

      // Calculate Jaccard similarity
      const similarity = (a, b) => {
        const setA = new Set(a);
        const setB = new Set(b);
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return intersection.size / union.size;
      };

      // Cluster using simple threshold-based approach
      const used = new Set();
      for (let i = 0; i < allReflections.length; i++) {
        if (used.has(i)) continue;

        const cluster = [allReflections[i]];
        const keywordsI = getKeywords(allReflections[i].description);

        for (let j = i + 1; j < allReflections.length; j++) {
          if (used.has(j)) continue;

          const keywordsJ = getKeywords(allReflections[j].description);
          if (similarity(keywordsI, keywordsJ) > 0.3) {
            cluster.push(allReflections[j]);
            used.add(j);
          }
        }

        if (cluster.length >= minClusterSize) {
          clusters.push({
            size: cluster.length,
            reflections: cluster,
            commonTags: findCommonTags(cluster),
            successRate: cluster.filter(r => r.outcome === 'successful').length / cluster.length
          });
        }

        used.add(i);
      }

      return clusters.sort((a, b) => b.size - a.size);
    };

    /**
     * Find recurring failure patterns
     */
    const detectFailurePatterns = async () => {
      const failed = await ReflectionStore.getReflections({
        outcome: 'failed',
        limit: 100
      });

      const patterns = {};
      for (const reflection of failed) {
        // Extract error indicators from description
        const indicators = extractFailureIndicators(reflection.description);

        for (const indicator of indicators) {
          if (!patterns[indicator]) {
            patterns[indicator] = {
              count: 0,
              examples: [],
              recommendations: []
            };
          }
          patterns[indicator].count++;
          if (patterns[indicator].examples.length < 3) {
            patterns[indicator].examples.push({
              sessionId: reflection.sessionId,
              description: reflection.description
            });
          }
        }
      }

      // Generate recommendations for common patterns
      for (const [indicator, data] of Object.entries(patterns)) {
        if (data.count >= 3) {
          data.recommendations = generateRecommendations(indicator);
        }
      }

      return patterns;
    };

    /**
     * Get top success strategies
     */
    const getTopSuccessStrategies = async (limit = 5) => {
      const successful = await ReflectionStore.getReflections({
        outcome: 'successful',
        limit: 100
      });

      const strategies = {};
      for (const reflection of successful) {
        const strategyTags = reflection.tags?.filter(t =>
          t.includes('strategy_') || t.includes('approach_')
        ) || [];

        for (const strategy of strategyTags) {
          strategies[strategy] = (strategies[strategy] || 0) + 1;
        }
      }

      return Object.entries(strategies)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([strategy, count]) => ({
          strategy,
          successCount: count,
          percentage: (count / successful.length * 100).toFixed(1)
        }));
    };

    /**
     * Recommend solution based on similar past reflections
     */
    const recommendSolution = async (currentProblem) => {
      const keywords = extractKeywords(currentProblem);
      const similar = await ReflectionStore.searchByKeywords(keywords, 10);

      const successful = similar.filter(r => r.outcome === 'successful');
      if (successful.length === 0) {
        return {
          found: false,
          message: 'No similar successful cases found'
        };
      }

      // Extract recommendations from successful cases
      const recommendations = successful
        .flatMap(r => r.recommendations || [])
        .reduce((acc, rec) => {
          acc[rec] = (acc[rec] || 0) + 1;
          return acc;
        }, {});

      return {
        found: true,
        topRecommendations: Object.entries(recommendations)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([rec, count]) => ({
            recommendation: rec,
            frequency: count,
            confidence: (count / successful.length * 100).toFixed(0) + '%'
          })),
        similarCases: successful.length
      };
    };

    return {
      clusterReflections,
      detectFailurePatterns,
      getTopSuccessStrategies,
      recommendSolution
    };
  }
};
```

**Integration Points:**

1. **Dashboard Reflections Panel** - Show pattern insights
2. **Sentinel FSM** - Use recommendations before planning
3. **Performance Monitor** - Track strategy effectiveness

**Testing Checklist:**
- [ ] Cluster 50 reflections into groups
- [ ] Detect at least 3 recurring failure patterns
- [ ] Get top 5 success strategies
- [ ] Recommend solution for known problem
- [ ] Pattern analysis runs in <1 second

**Success Criteria:**
- Agent can identify "approaches that work"
- Failure patterns are surfaced to user
- Recommendations improve success rate over time

---

### ✅ 7. Add Vision Model Support to LocalLLM

**Status:** COMPLETED
**Priority:** HIGH
**Effort:** Medium (5-6 hours)
**Impact:** High - Enables multi-modal RSI

**Vision:**
Extend local inference to support vision-capable models, enabling the agent to:
- **Analyze diagrams** (architecture diagrams, flowcharts)
- **Read screenshots** (UI mockups, error messages)
- **Understand visualizations** (charts, graphs from canvas viz)
- **Process images** (icons, logos, visual assets)

**Current State:**
- WebLLM supports vision models (Phi-3.5-vision, LLaVA)
- LocalLLM only handles text inputs
- No UI for image upload to local LLM

**Models to Support:**
- `Phi-3.5-vision-instruct-q4f16_1-MLC` (4.2GB)
- `llava-v1.5-7b-q4f16_1-MLC` (4.5GB)

**Implementation Steps:**

1. **Update local-llm.js:**
```javascript
// Add image support to chat function
const chat = async (messages, options = {}) => {
  if (!isReady || !engine) {
    throw new Error('LocalLLM not ready');
  }

  // Format messages with image support
  const formattedMessages = messages.map(msg => {
    const content = [];

    // Add text part
    if (msg.content) {
      content.push({ type: 'text', text: msg.content });
    }

    // Add image parts
    if (msg.images && Array.isArray(msg.images)) {
      for (const image of msg.images) {
        if (typeof image === 'string') {
          // Image URL or data URL
          content.push({ type: 'image_url', image_url: { url: image } });
        }
      }
    }

    return {
      role: msg.role,
      content: content.length === 1 && content[0].type === 'text'
        ? content[0].text
        : content
    };
  });

  // Rest of chat implementation...
};
```

2. **Update UI (ui-manager.js) - Add image upload to LLM test panel:**
```javascript
<div class="llm-test-panel">
  <textarea id="llm-test-prompt">Describe this image</textarea>
  <div class="llm-image-upload">
    <label for="llm-test-image">Upload Image:</label>
    <input type="file" id="llm-test-image" accept="image/*" />
    <img id="llm-test-preview" style="max-width: 200px; display: none;" />
  </div>
  <button id="llm-test-btn">Test Inference</button>
</div>
```

3. **Add image upload handler:**
```javascript
const imageInput = document.getElementById('llm-test-image');
const preview = document.getElementById('llm-test-preview');

imageInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (event) => {
      preview.src = event.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
});

// Update test button handler
testBtn.addEventListener('click', async () => {
  const prompt = promptInput.value;
  const imageDataUrl = preview.src;

  const messages = [{
    role: 'user',
    content: prompt,
    images: imageDataUrl ? [imageDataUrl] : []
  }];

  const response = await LocalLLM.chat(messages, { stream: false });
  outputArea.textContent = response.text;
});
```

4. **Add vision model to model selector:**
```html
<select id="llm-model-select">
  <option value="Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC">Qwen2.5 Coder 1.5B (~900MB)</option>
  <option value="Phi-3.5-mini-instruct-q4f16_1-MLC">Phi-3.5 Mini (~2.1GB)</option>
  <option value="Phi-3.5-vision-instruct-q4f16_1-MLC">Phi-3.5 Vision (~4.2GB) 🖼️</option>
  <option value="Llama-3.2-1B-Instruct-q4f16_1-MLC">Llama 3.2 1B (~900MB)</option>
  <option value="gemma-2-2b-it-q4f16_1-MLC">Gemma 2 2B (~1.2GB)</option>
  <option value="llava-v1.5-7b-q4f16_1-MLC">LLaVA 1.5 7B (~4.5GB) 🖼️</option>
</select>
```

**Use Cases:**

**Use Case 1: Screenshot Analysis**
```
User: "Analyze this error screenshot"
Agent: [Loads screenshot] "I see a TypeError at line 42 in api-client.js.
        The error is 'Cannot read property 'text' of undefined'.
        This is because response.candidates is null when rate limited."
```

**Use Case 2: Diagram Understanding**
```
User: "Explain this architecture diagram"
Agent: [Loads diagram] "This shows a 3-tier architecture with:
        - Frontend (React) making API calls
        - Backend (Node.js) handling business logic
        - Database (PostgreSQL) for persistence
        The arrows indicate data flow from client → server → database"
```

**Testing Checklist:**
- [ ] Load Phi-3.5-vision model successfully
- [ ] Upload image via file input
- [ ] Preview shows uploaded image
- [ ] Inference with image + text works
- [ ] Response describes image accurately
- [ ] Multiple images in single message work
- [ ] Falls back gracefully if model doesn't support vision

**Success Criteria:**
- Agent can analyze uploaded images
- Vision model responses are accurate
- Image + text prompts work together
- Download progress shows for large vision models

---

### ✅ 8. Auto-Apply Performance Optimizations

**Status:** COMPLETED
**Priority:** HIGH
**Effort:** Medium (4-5 hours)
**Impact:** High - System self-optimizes over time

**Vision:**
Transform PerformanceOptimizer from passive monitoring to active optimization:
- **Automatically cache** slow operations
- **Add memoization** to pure functions
- **Throttle** high-frequency event handlers
- **Batch** repeated operations
- **Pre-fetch** commonly accessed data

**Current State:**
- PerformanceOptimizer detects bottlenecks (`performance-optimizer.js:263-319`)
- Generates optimization suggestions (`performance-optimizer.js:322-373`)
- `selfOptimize()` exists but only logs suggestions (`performance-optimizer.js:407-453`)

**Implementation Strategy:**

1. **Create optimization wrappers:**
```javascript
// In performance-optimizer.js

// Memoization wrapper for pure functions
const memoize = (fn, keyFn = JSON.stringify) => {
  const cache = new Map();

  return (...args) => {
    const key = keyFn(args);
    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = fn(...args);
    cache.set(key, result);

    // LRU eviction - keep cache size under 100 entries
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    return result;
  };
};

// Throttle wrapper for frequent operations
const throttle = (fn, delay = 100) => {
  let lastCall = 0;
  let timeoutId = null;

  return (...args) => {
    const now = Date.now();

    if (now - lastCall >= delay) {
      lastCall = now;
      return fn(...args);
    } else {
      // Queue delayed execution
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        fn(...args);
      }, delay);
    }
  };
};

// Batch wrapper for repeated operations
const batch = (fn, delay = 50) => {
  let queue = [];
  let timeoutId = null;

  return (item) => {
    queue.push(item);

    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      const items = queue;
      queue = [];
      fn(items);
    }, delay);
  };
};
```

2. **Update selfOptimize() to apply wrappers:**
```javascript
const selfOptimize = async () => {
  logger.info('[PerformanceOptimizer] Starting self-optimization');

  const suggestions = generateOptimizations();
  const optimizations = [];

  for (const suggestion of suggestions) {
    if (suggestion.priority === 'high') {
      logger.info(`[PerformanceOptimizer] Applying: ${suggestion.suggestion}`);

      switch (suggestion.type) {
        case 'performance': {
          // Get the slow function from DI container
          const target = suggestion.target; // e.g., "StateManager.getArtifactContent"
          const [moduleName, methodName] = target.split('.');

          const module = DIContainer.get(moduleName);
          if (module && module[methodName]) {
            // Wrap with memoization
            const original = module[methodName];
            module[methodName] = memoize(original);

            optimizations.push({
              type: 'memoization',
              target,
              applied: true
            });

            logger.info(`[PerformanceOptimizer] Applied memoization to ${target}`);
          }
          break;
        }

        case 'memory': {
          // Trigger garbage collection
          if (window.gc) {
            window.gc();
            optimizations.push({ type: 'gc', applied: true });
          }

          // Clear caches
          performance.clearMarks();
          performance.clearMeasures();

          optimizations.push({ type: 'cache-clear', applied: true });
          break;
        }

        case 'reliability': {
          // Wrap error-prone functions with retry logic
          const target = suggestion.target;
          const [moduleName, methodName] = target.split('.');

          const module = DIContainer.get(moduleName);
          if (module && module[methodName]) {
            const original = module[methodName];

            // Add retry wrapper
            module[methodName] = async (...args) => {
              const maxRetries = 3;
              for (let i = 0; i < maxRetries; i++) {
                try {
                  return await original(...args);
                } catch (error) {
                  if (i === maxRetries - 1) throw error;
                  await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
                }
              }
            };

            optimizations.push({
              type: 'retry-wrapper',
              target,
              applied: true
            });
          }
          break;
        }
      }
    }
  }

  logger.info(`[PerformanceOptimizer] Applied ${optimizations.length} optimizations`);

  // Store optimization history
  await StateManager.updateState(state => {
    state.performanceOptimizations = state.performanceOptimizations || [];
    state.performanceOptimizations.push({
      timestamp: Date.now(),
      optimizations
    });
    return state;
  });

  return optimizations;
};
```

3. **Trigger auto-optimization periodically:**
```javascript
// In boot.js, after initialization
const PerformanceOptimizer = DIContainer.get('PerformanceOptimizer');

// Auto-optimize every 5 minutes
setInterval(async () => {
  const report = PerformanceOptimizer.getReport();

  if (report.bottlenecks.length > 0) {
    logger.info('[Boot] Triggering auto-optimization');
    await PerformanceOptimizer.selfOptimize();
  }
}, 5 * 60 * 1000);
```

**Testing Checklist:**
- [ ] Slow function detected (avg > 50ms)
- [ ] Memoization wrapper applied automatically
- [ ] Subsequent calls hit cache (faster)
- [ ] Memory optimization triggers GC
- [ ] Error-prone function gets retry wrapper
- [ ] Optimization history stored in state
- [ ] Auto-optimization runs every 5 minutes

**Success Criteria:**
- System automatically speeds up slow operations
- Memory usage stays under 70%
- Retry wrappers reduce error rates
- Performance improves over time without manual intervention

---

## 📦 P2: MEDIUM IMPACT (Usability & Robustness)

These improve system reliability and user experience.

### ✅ 9. Integrate Canvas Visualizer into Dashboard

**Status:** COMPLETED
**Priority:** MEDIUM
**Effort:** Low (2-3 hours)
**Impact:** Medium - Better visual introspection

**Problem:**
Canvas visualizer exists (`canvas-visualizer.js` - 658 lines) with 5 visualization modes (dependency, cognitive, memory, goals, tools), but it's not exposed in the dashboard UI. Users cannot see real-time agent cognitive flow.

**Implementation:**

1. **Add canvas viz panel to ui-dashboard.html:**
```html
<div id="canvas-viz-panel" class="panel hidden" role="region" aria-labelledby="canvas-viz-title">
  <h2 id="canvas-viz-title">Agent Visualization</h2>
  <div id="canvas-viz-container" style="width: 100%; height: 400px; position: relative;">
    <!-- Canvas will be inserted here -->
  </div>
  <div class="canvas-viz-controls">
    <button class="viz-mode-btn" data-mode="dependency">Dependencies</button>
    <button class="viz-mode-btn" data-mode="cognitive">Cognitive Flow</button>
    <button class="viz-mode-btn" data-mode="memory">Memory Heatmap</button>
    <button class="viz-mode-btn" data-mode="goals">Goal Tree</button>
    <button class="viz-mode-btn" data-mode="tools">Tool Usage</button>
  </div>
</div>
```

2. **Add to panel cycle in ui-manager.js:**
```javascript
// Update panel list (line ~50)
const panels = [
  'thoughts', 'performance', 'introspection', 'reflections',
  'tests', 'apis', 'agent-viz', 'ast-viz', 'python-repl',
  'local-llm', 'canvas-viz', 'logs' // <- Add canvas-viz
];
```

3. **Initialize canvas viz in ui-manager.js:**
```javascript
const renderCanvasVizPanel = async () => {
  const CanvasViz = DIContainer.get('CanvasVisualizer');
  if (!CanvasViz) return;

  const container = document.getElementById('canvas-viz-container');
  if (!container) return;

  // Initialize canvas
  const viz = await CanvasViz.init();

  // Set up mode switcher
  document.querySelectorAll('.viz-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      viz.setMode(mode);
    });
  });

  // Update visualization when agent state changes
  EventBus.on('fsm:state:changed', (data) => {
    viz.triggerNodePulse(data.newState);
  });

  EventBus.on('tool:executed', (data) => {
    viz.triggerNodePulse(data.toolName);
  });
};
```

**Testing Checklist:**
- [ ] Canvas viz appears as 11th panel in cycle
- [ ] Mode buttons switch visualization types
- [ ] Dependency graph shows module connections
- [ ] Cognitive flow shows agent reasoning
- [ ] Memory heatmap shows access patterns
- [ ] Nodes pulse when agent uses them
- [ ] Zoom and pan work correctly

**Success Criteria:**
- Canvas viz accessible from dashboard
- Real-time updates during agent execution
- All 5 visualization modes work

---

### ✅ 10. Add Tool Usage Analytics

**Status:** COMPLETED
**Priority:** MEDIUM
**Effort:** Low (2-3 hours)
**Impact:** Medium - Identify tool bottlenecks

**Implementation:**
Track tool execution metrics in PerformanceMonitor and display in dashboard.

(Full details would go here - keeping checklist concise)

---

### ✅ 11. Implement Inter-Tab State Coordination

**Status:** COMPLETED
**Priority:** MEDIUM
**Effort:** Medium (3-4 hours)
**Impact:** Medium - Prevent state corruption

**Implementation:**
Use BroadcastChannel to sync state across tabs, implement last-write-wins with timestamps.

---

### ✅ 12. Add Retry Logic with Exponential Backoff for API Calls

**Status:** COMPLETED
**Priority:** MEDIUM
**Effort:** Low (1-2 hours)
**Impact:** Medium - More reliable cloud inference

**Implementation:**
- Added retry logic to `api-client-multi.js`
- 3 retry attempts with exponential backoff (1s, 2s, 4s)
- Retries on rate limits (429) and server errors (500-504)
- Skips retry on non-retriable errors (AbortError, client errors)
- Logs retry attempts for debugging

**Files Modified:**
- `upgrades/api-client-multi.js` - Added `isRetriableError()` and retry loop in `callApiWithRetry()`

---

### ✅ 13. Implement Checkpoint Auto-Save on Milestones

**Status:** COMPLETED
**Priority:** MEDIUM
**Effort:** Low (1-2 hours)
**Impact:** Medium - Easy rollback

**Implementation:**
- Auto-creates checkpoint before applying changes (pre-apply safety)
- Auto-creates checkpoint after successful cycle completion
- Checkpoints include descriptive messages with goal context
- Gracefully handles checkpoint failures without blocking agent

**Files Modified:**
- `upgrades/sentinel-fsm.js` - Added checkpoint creation in `executeApplyingChangeset()` state

---

## 🎨 P3: NICE-TO-HAVE (Polish & Documentation)

### ✅ 14. Add JSDoc Comments to All Public APIs

**Status:** COMPLETED
**Effort:** High (6-8 hours across all modules)

**Implementation:**
- Added comprehensive JSDoc comments to critical modules
- Documented all public functions with parameter types and return values
- Added module-level documentation with version and category metadata

**Files Modified:**
- `upgrades/api-client-multi.js` - Full JSDoc coverage for all public APIs
- `upgrades/sentinel-fsm.js` - Module and state machine documentation

---

### ✅ 15. Create Unit Tests for Pure Functions

**Status:** COMPLETED
**Effort:** Medium (4-6 hours)

**Implementation:**
- Created comprehensive test suite for `agent-logic-pure.js`
- 25+ unit tests covering all pure helper functions
- Tests for artifact list formatting, tool list formatting, and prompt assembly
- Includes assertion helpers and result reporting

**Files Created:**
- `tests/agent-logic-pure.test.js` - Complete test suite with 25+ tests

---

### ✅ 16. Add Rate Limiting and Cost Tracking

**Status:** COMPLETED
**Effort:** Medium (3-4 hours)

**Implementation:**
- Created `CostTracker` module for API usage and cost monitoring
- Rate limiting with per-provider thresholds (RPM limits)
- Cost calculation based on input/output tokens and provider pricing
- Session and all-time cost tracking
- Cost breakdown by provider with detailed statistics
- Automatic state persistence

**Files Created:**
- `upgrades/cost-tracker.js` - Complete cost tracking and rate limiting system
- Registered as `COST` module in config.json

**Features:**
- Tracks: Gemini ($0.075/$0.30 per 1M tokens), OpenAI, Anthropic, Local (free)
- Rate limits: Gemini (15 RPM), OpenAI (10 RPM), Anthropic (5 RPM)
- Generates markdown reports with cost breakdown and rate limit status

---

### ✅ 17. Implement Semantic Search Over Reflections

**Status:** COMPLETED
**Effort:** High (8-10 hours)

**Implementation:**
- Created `ReflectionSearch` module using TF-IDF embeddings
- Semantic similarity search using cosine similarity
- Find similar reflections by meaning, not just keywords
- Context-aware reflection retrieval
- Automatic index rebuilding with TTL (5 minutes)

**Files Created:**
- `upgrades/reflection-search.js` - TF-IDF semantic search system
- Registered as `RESRCH` module in config.json

**Features:**
- Tokenization and TF-IDF vectorization
- Cosine similarity ranking
- `search(query, options)` - Semantic search with threshold filtering
- `findSimilar(reflectionId, limit)` - Find similar past experiences
- `getRelevantForContext(context)` - Context-aware retrieval
- Index statistics and manual rebuild capability

---

### ✅ 18. Add Tool Documentation Generator

**Status:** COMPLETED
**Effort:** Low (2-3 hours)

**Implementation:**
- Created `ToolDocGenerator` module for automatic markdown generation
- Parses tool schemas from `tools-read.json` and `tools-write.json`
- Generates comprehensive reference documentation
- Includes parameter tables, return types, and examples

**Files Created:**
- `upgrades/tool-doc-generator.js` - Automatic documentation generator
- Registered as `TDOC` module in config.json

**Features:**
- `generateDocs()` - Complete tool reference (all tools)
- `generateSummary()` - Quick summary table
- `generateByCategory(category)` - Read or write tools only
- `generateAndSave()` - Generate and save to VFS
- Outputs: `TOOL-REFERENCE.md`, `TOOL-SUMMARY.md`, `READ-TOOLS.md`, `WRITE-TOOLS.md`

---

## 📊 Implementation Roadmap

### Sprint 1: Fix Critical Blockers (P0)
**Duration:** 1-2 days
**Items:** 1-3
**Goal:** Fix HybridLLM integration, Python tools, Git VFS bugs

### Sprint 2: Enable Swarm Intelligence (P1 Priority)
**Duration:** 1 week
**Items:** 4-6
**Goal:** Multi-agent coordination, reflection mining, streaming

### Sprint 3: Vision & Auto-Optimization (P1 Remaining)
**Duration:** 1 week
**Items:** 7-8
**Goal:** Multi-modal support, self-optimization

### Sprint 4: Robustness & UX (P2)
**Duration:** 1 week
**Items:** 9-13
**Goal:** Dashboard improvements, reliability enhancements

### Sprint 5: Polish (P3)
**Duration:** Ongoing
**Items:** 14-18
**Goal:** Documentation, testing, cost tracking

---

## 🎯 Success Metrics

Track these KPIs to measure enhancement impact:

1. **Agent Success Rate**: % of cycles that complete successfully
2. **Local Inference Usage**: % of completions using local vs cloud
3. **Swarm Coordination**: # of tasks delegated to peers per session
4. **Reflection Learning**: Improvement in success rate over time
5. **Performance Gains**: Reduction in avg operation duration
6. **Error Rate**: # of errors per 100 operations
7. **Cost Savings**: $ saved via local inference

---

## 📝 Notes

- All P0 items are pre-requisites for full AR-2 functionality
- Swarm intelligence (#4) is the highest-impact enhancement
- Vision support (#7) enables next-gen multi-modal RSI
- Pattern recognition (#6) is key to learning from experience

**Last Updated:** 2025-10-01
