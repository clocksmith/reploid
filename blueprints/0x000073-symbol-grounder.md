# Symbol Grounder

**Module:** `SymbolGrounder`
**File:** `./capabilities/cognition/symbolic/symbol-grounder.js`
**Purpose:** Connects abstract symbols to concrete meanings/actions

## Overview

Symbol grounding problem: How do abstract symbols (words, concepts) connect to real-world referents? This module maps symbolic names to operational meanings.

## Implementation

```javascript
const SymbolGrounder = {
  metadata: {
    id: 'SymbolGrounder',
    dependencies: ['Utils', 'ToolRunner', 'VFS'],
    type: 'capability'
  },

  factory: (deps) => {
    const { logger } = deps.Utils;
    const { ToolRunner, VFS } = deps;

    const _groundings = new Map();

    const ground = (symbol, grounding) => {
      _groundings.set(symbol, {
        type: grounding.type, // 'tool' | 'file' | 'concept'
        reference: grounding.reference,
        description: grounding.description,
        operational: grounding.operational // function to execute
      });
    };

    const resolve = async (symbol) => {
      const grounding = _groundings.get(symbol);
      if (!grounding) {
        throw new Error(`Symbol not grounded: ${symbol}`);
      }
      return grounding;
    };

    const execute = async (symbol, args = {}) => {
      const grounding = await resolve(symbol);
      if (!grounding.operational) {
        throw new Error(`Symbol ${symbol} has no operational meaning`);
      }
      return await grounding.operational(args);
    };

    return { ground, resolve, execute };
  }
};
```

## Example Groundings

```javascript
// Ground 'read-code' symbol to VFS.read tool
symbolGrounder.ground('read-code', {
  type: 'tool',
  reference: 'read_file',
  description: 'Reading code from VFS',
  operational: async (args) => await VFS.read(args.path)
});

// Ground 'module' concept to file pattern
symbolGrounder.ground('module', {
  type: 'concept',
  reference: '*.js files in core/ or infrastructure/',
  description: 'JavaScript module files',
  operational: async () => await VFS.list(['./core/', './infrastructure/'])
});
```
