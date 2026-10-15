/** Examples host adapter; the diamond renderer owns no application state. */
import { bindDiamondRenderer } from '../components/diamond-renderer.js';
import { POOLDAY_RUN_VISUAL_EVENT } from './constants.js';
import { subscribeContributionState } from './contribution-state.js';

export function bindPoolPrism(mount) {
  const shell = mount.querySelector('[data-pool-prism]');
  if (!shell) return () => {};
  let requestBusy = ['running', 'submitting'].includes(window.REPLOID_POOL_RUN_VISUAL_STATE?.state);
  let providerBusy = false;
  const stats = {}; window.REPLOID_POOL_PRISM_STATS = stats;
  const dispose = bindDiamondRenderer(shell, { stats, isBusy: () => requestBusy || providerBusy });
  const onRun = event => { requestBusy = ['running', 'submitting'].includes(event.detail?.state); dispose.refresh?.(); };
  window.addEventListener(POOLDAY_RUN_VISUAL_EVENT, onRun);
  const unsubscribe = subscribeContributionState(state => {
    providerBusy = state.state === 'working' || state.state === 'starting'; dispose.refresh?.();
  });
  return () => { window.removeEventListener(POOLDAY_RUN_VISUAL_EVENT, onRun); unsubscribe(); dispose(); };
}
