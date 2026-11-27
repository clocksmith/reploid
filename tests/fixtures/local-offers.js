/**
 * This device's offers as work-swarm.js reports them (getState().localOffers): `true` an offer that stands, `false`
 * a paused one (the person chose it, then stopped), omitted no offer. Readiness is the caller's when it matters.
 */
import { inferenceOffer, weightSupplyOffer } from '../../packages/reploid/src/contracts/computer-records.js';

export function localOffers({ compute, files, computeReadiness = 'unavailable', filesReadiness = 'unavailable' } = {}) {
  return [
    compute === undefined ? null : inferenceOffer({ readiness: compute ? computeReadiness : 'unavailable', paused: !compute }),
    files === undefined ? null : weightSupplyOffer({ readiness: files ? filesReadiness : 'unavailable', paused: !files })
  ].filter(Boolean);
}
