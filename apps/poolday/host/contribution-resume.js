import { LAUNCH_MODEL } from '../../../shared/pool/model-contract.js';
import { getPeerRoomId, getPeerRelayMode } from './product-context.js';
export const POOL_CONTRIBUTION_RESUME_STORAGE_KEY = 'reploid.pool.contribution-resume.v1';
export const readContributionResumeIntent = () => {
  try {
    const parsed = JSON.parse(window.sessionStorage?.getItem(POOL_CONTRIBUTION_RESUME_STORAGE_KEY) || 'null');
    return parsed?.active === true ? parsed : null;
  } catch {
    try {
      window.sessionStorage?.removeItem(POOL_CONTRIBUTION_RESUME_STORAGE_KEY);
    } catch {
      // A malformed recovery record must not prevent the current page from loading.
    }
    return null;
  }
};

export const writeContributionResumeIntent = ({ modelId } = {}) => {
  const intent = {
    active: true,
    modelId: modelId || LAUNCH_MODEL.modelId,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    updatedAt: new Date().toISOString()
  };
  try {
    window.sessionStorage?.setItem(POOL_CONTRIBUTION_RESUME_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // The current provider session remains active when persistence is unavailable.
  }
  return intent;
};

export const clearContributionResumeIntent = () => {
  try {
    window.sessionStorage?.removeItem(POOL_CONTRIBUTION_RESUME_STORAGE_KEY);
  } catch {
    // The current provider session still stops when persistence is unavailable.
  }
};
