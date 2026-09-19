export * from './agent/index.js';
// Compatibility entry. New consumers can import reploid/agent without lab strategy code.
export { default as AgentLoop } from './agent/legacy-loop.js';
