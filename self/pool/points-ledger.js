/**
 * @fileoverview Client helpers for pool points ledger views.
 */

export function summarizePoints(events = []) {
  return events.reduce((summary, event) => {
    const points = Number(event.points || 0);
    summary.total += points;
    summary.count += 1;
    summary.byReason[event.reason || event.eventType || 'unknown'] = (summary.byReason[event.reason || event.eventType || 'unknown'] || 0) + points;
    return summary;
  }, { total: 0, count: 0, byReason: {} });
}

export default {
  summarizePoints
};
