/**
 * The permission prompt for sending a thread's request to another computer: which attempt is waiting for it, how the
 * prompt reads, and the two answers. Moved here from the conversation controller (conversation-controller.js), which
 * looked the waiting attempt up in three places. The session grants or declines; this only finds and words it.
 */
import { remotePermissionText, remotePermissionWording } from '../../ui/pool-home/remote-permission.js';

/** The thread's attempt waiting for permission to send to another computer, if any. */
export const pendingApproval = thread => thread?.attempts?.find(item => item.status === 'approval' && item.approval?.permissionNeed) ?? null;

/** The prompt the snapshot shows for that attempt, or null. */
export function remotePermissionView(thread) {
  const pending = pendingApproval(thread);
  return pending ? {
    key: `${pending.id}:${pending.approval.id}`,
    title: 'Send to another computer?', what: remotePermissionText(pending.approval.permissionNeed).what,
    recipient: pending.approval.recipientIdentity || pending.approval.permissionNeed.routeId || 'another computer'
  } : null;
}

/** Allow grants the permission the attempt needs, in the session's own wording; decline answers that attempt. */
export function createRemoteApproval({ session, thread, act }) {
  return {
    allow() {
      const pending = pendingApproval(thread());
      if (pending) void act(() => session.grantRemotePermission(pending.approval.permissionNeed, { wording: remotePermissionWording(pending.approval.permissionNeed) }));
    },
    decline() {
      const current = thread(), pending = pendingApproval(current);
      if (pending) void act(() => session.approve(current.id, pending.id, pending.approval.id, false));
    }
  };
}
