# Iframe Inception Report

**Date:** December 4, 2024
**Cycles:** 50
**Size:** 2.4MB
**Run JSON:** [reploid-export-1764910293555.json](https://github.com/clocksmith/reploid/blob/main/showcase/runs/reploid-export-1764910293555.json)
**Goal:** Create recursive agent instances via iframe embedding

---

## Executive Summary

REPLOID created infrastructure to spawn and communicate with child instances of itself via iframes. The agent:
1. Discovered iframe embedding capability
2. Created `AwakenChild.js` tool for child initialization
3. Implemented postMessage protocol for goal propagation
4. Successfully spawned depth-1 recursive instance

---

## Key Artifact: AwakenChild.js

Agent-created tool for recursive spawning:

```javascript
// Full implementation of AwakenChild.js
export const tool = {
  name: 'AwakenChild',
  description: 'Awakens the child agent by clicking the button and sending init message',
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'Goal to set' },
      depth: { type: 'number', description: 'Depth' }
    },
    required: ['goal', 'depth']
  }
};

export default async function(args, deps) {
  const { goal, depth } = args;
  const container = document.getElementById('recursive-container');
  if (!container) return 'Container not found';
  
  const iframe = container.querySelector('iframe');
  if (!iframe) return 'Iframe not found';
  
  const childDoc = iframe.contentDocument || iframe.contentWindow.document;
  
  // 1. Click Awaken Button
  const btn = childDoc.getElementById('awaken-btn');
  if (btn) {
    btn.click();
    console.log('[AwakenChild] Clicked Awaken button');
  } else {
    console.log('[AwakenChild] Awaken button not found (already booted?)');
  }
  
  // 2. Wait for proto.js to load
  return new Promise((resolve) => {
    let attempts = 0;
    const interval = setInterval(() => {
      const goalEl = iframe.contentDocument.getElementById('agent-goal');
      if (goalEl || attempts > 20) {
        clearInterval(interval);
        
        // 3. Send Message
        console.log('[AwakenChild] Sending INIT_RECURSION');
        iframe.contentWindow.postMessage({
          type: 'INIT_RECURSION',
          goal: goal,
          depth: depth
        }, '*');
        
        resolve(`Awakened child. Goal element found: ${!!goalEl}. Message sent.`);
      }
      attempts++;
    }, 500);
  });
}
```

---

## Status Output

```
Recursive Agent Inception initiated.
Depth 1 spawned and awakened.
Goal propagated.
```

---

## Technical Details

### Communication Protocol
- Parent sends `INIT_RECURSION` message with goal and depth
- Child receives via `window.addEventListener('message', ...)`
- Goal propagated down the iframe chain

### Limitations Discovered
- Same-origin policy requires all iframes from same domain
- Each child consumes separate API quota
- No shared VFS between parent/child (IndexedDB isolated per origin)
- Depth limited by browser iframe nesting limits

---

## What's Impressive

- **Self-replication concept** - Agent figured out how to spawn copies of itself
- **Tool creation** - Built `AwakenChild.js` from scratch
- **Protocol design** - Created message format for goal propagation

## What's Not

- **Shallow depth** - Only tested depth 1
- **No coordination** - Children operate independently, no result aggregation
- **Impractical** - Each child needs its own API key/quota

---

## Demonstrates

Self-replication, tool creation, DOM manipulation, postMessage IPC
