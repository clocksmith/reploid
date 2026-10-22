/** Route policy for the shared, independently verified tool creator. */
import { isMinimalLabMode } from '../config/lab-upgrades.js';
import createTool, { tool as definition } from '../core/create-tool.js';

const getRuntimeMode = () => {
  try {
    if (typeof window !== 'undefined' && typeof window.getReploidMode === 'function') {
      return window.getReploidMode();
    }
  } catch {
    // Fall back to the broader staged behavior outside the browser runtime.
  }
  return 'reploid';
};


const call = (args = {}, deps = {}) => createTool(args, deps, {
  minimalMode: isMinimalLabMode(getRuntimeMode())
});

export const tool = { ...definition, call };
export default call;
