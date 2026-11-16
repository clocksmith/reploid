/** Role-bound accounting and reputation read projections. */

import { asyncRoute, requireBoundAnyRole } from '../http-admission.js';



export function registerPoolAccountViews(router, { store }) {
  router.get('/points/:userId', asyncRoute(async (req, res) => {
    if (!requireBoundAnyRole(req, res, ['requester', 'agent', 'provider'], req.params.userId)) return null;
    const events = await store.listLedger(req.params.userId);
    const total = events.reduce((sum, event) => sum + Number(event.points || 0), 0);
    return res.json({ userId: req.params.userId, total, events });
  }));

  router.get('/reputation/:providerId', asyncRoute(async (req, res) => {
    return res.json(await store.getReputation(req.params.providerId));
  }));
}
