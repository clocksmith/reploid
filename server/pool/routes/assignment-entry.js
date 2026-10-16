/** Recover before rereading and authenticating an assignment. Phase policy stays in each route. */
export const createAssignmentEntryReader = ({ store, recoverHostedAssignments, requireBoundRole }) => async (req, res) => {
  const pendingAssignment = await store.getAssignment(req.params.assignmentId);
  const entryRecovery = await recoverHostedAssignments({ store, targetJobId: pendingAssignment?.jobId || null });
  const assignment = await store.getAssignment(req.params.assignmentId);
  if (!assignment) {
    res.status(404).json({ error: 'assignment not found' });
    return null;
  }
  if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
  return { assignment, entryRecovery };
};
