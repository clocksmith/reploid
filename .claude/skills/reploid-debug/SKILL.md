---
name: reploid-debug
description: Debug Reploid agent issues. Use when investigating agent loop problems, tool execution failures, VFS issues, or state management bugs in the browser-based RSI substrate.
---

# Reploid Debug Skill

You are debugging Reploid, a browser-native self-modifying AI agent.

## Key Paths (from reploid root)

- `doppler/reploid/core/` - Agent loop, VFS, LLM client, tool runner
- `doppler/reploid/infrastructure/` - EventBus, DI container, HITL controller
- `doppler/reploid/tools/` - Agent tools
- `doppler/reploid/tests/` - Test suites

## Common Debug Commands

```bash
cd doppler/reploid
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests
npm start                   # Start dev server
```

## Debug Checklist

1. **Agent Loop Issues**: Check `core/agent-loop.js` and `core/state-manager.js`
2. **Tool Failures**: Check `core/tool-runner.js` and specific tool in `tools/`
3. **VFS Issues**: Check `core/vfs.js` and IndexedDB state
4. **State Problems**: Check `core/state-manager.js` and `infrastructure/event-bus.js`

## Architecture

```
User Input -> AgentLoop -> LLMClient -> Tool Selection
                  |             |
            StateManager   ToolRunner -> VFS (IndexedDB)
                  |             |
            ContextManager  SchemaRegistry
                  |
            EventBus <-> HITL Controller
```
