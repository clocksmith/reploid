# Capabilities Directory

**Purpose**: Advanced RSI (Recursive Self-Improvement) capabilities that extend the agent's intelligence.

## Active Capabilities

The following capabilities are currently active and integrated into the REPLOID core:

### Reflection
- `reflection-store.js` - Persistent storage for insights, errors, and success patterns.
- `reflection-analyzer.js` - Analyzes history to detect failure patterns and suggest improvements.

### Performance
- `performance-monitor.js` - Tracks tool usage, API tokens, and error rates.

### Testing
- `self-tester.js` - Basic system diagnostics and health checks.

---

## Usage

Capabilities are registered in `boot.js` based on the selected **Genesis Level**:

- **Tabula Rasa**: No capabilities loaded.
- **Minimal**: Loads `PerformanceMonitor`.
- **Full**: Loads all capabilities (`ReflectionStore`, `ReflectionAnalyzer`, `PerformanceMonitor`, `SelfTester`).

---

## Integration

- **Agent Loop**: Injects `ReflectionAnalyzer` insights into the context window.
- **Tool Runner**: Triggers `PerformanceMonitor` events on tool execution.
- **Event Bus**: Used for decoupled communication between core and capabilities.
