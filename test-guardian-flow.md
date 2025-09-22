# Guardian Agent Flow Test Guide

## Overview
This document provides a step-by-step guide to test the complete Project Sentinel Guardian Agent flow with human-in-the-loop approvals.

## Test Scenario
We'll test the agent's ability to:
1. Curate context for a task (cats.md)
2. Get human approval for context
3. Generate a change proposal (dogs.md)
4. Get human approval for changes
5. Apply approved changes with checkpoint/rollback

## Testing Steps

### 1. Launch REPLOID
Open `index.html` in your browser and wait for the system to initialize.

### 2. Set a Test Goal
In the goal input field, enter:
```
Add a comment to the utils.js file explaining its purpose
```

### 3. Context Curation Phase
- The agent will transition to `CURATING_CONTEXT` state
- It will create a cats.md bundle with relevant files
- The Sentinel Control panel will show "Review Context"
- Review the selected files and click "Approve"

### 4. Planning Phase
- After approval, agent transitions to `PLANNING_WITH_CONTEXT`
- The agent analyzes the context and plans changes

### 5. Proposal Generation
- Agent creates a dogs.md bundle with proposed changes
- The state becomes `AWAITING_PROPOSAL_APPROVAL`

### 6. Interactive Diff Review
- The diff viewer should display:
  - File to be modified: `/upgrades/utils.js`
  - Operation: MODIFY
  - Side-by-side diff showing the added comment
- You can:
  - Approve/reject individual files
  - Approve all changes
  - Edit the proposal

### 7. Apply Changes
- Click "Apply Approved Changes"
- The agent will:
  - Create a checkpoint
  - Apply the changes
  - Run verification (if configured)
  - Commit to Git VFS (if available)

### 8. Reflection Phase
- Agent enters `REFLECTING` state
- Analyzes the outcome
- Generates insights for future improvements
- Returns to `IDLE` state

## Expected Outcomes

✅ **Success Indicators:**
- Smooth state transitions visible in UI
- Context bundle correctly created in `/sessions/*/turn-0.cats.md`
- Change proposal in `/sessions/*/turn-0.dogs.md`
- Interactive diff viewer shows changes clearly
- Changes applied to target file
- Checkpoint created in `/.checkpoints/`

❌ **Common Issues:**
- Module loading errors: Check browser console for module registration
- State stuck in AWAITING: Ensure EventBus is properly wired
- Diff viewer not showing: Check container ID matches UI
- Changes not applied: Verify StateManager has checkpoint methods

## Debugging

Enable advanced logs to see detailed flow:
1. Click "Show Advanced Logs" in the UI
2. Check browser console for `[SentinelFSM]` messages
3. Monitor state transitions in Sentinel Control panel

## Verification Commands

In browser console:
```javascript
// Check current FSM state
StateManager.getState().currentGoal

// View session info
StateManager.sessionManager.getActiveSessionId()

// List checkpoints
StateManager.getAllArtifactMetadata().then(m =>
  Object.keys(m).filter(k => k.startsWith('/.checkpoints/'))
)
```

## Next Steps

After successful test:
1. Try more complex goals requiring multiple file changes
2. Test the rollback functionality by causing a verification failure
3. Experiment with the REFLECTING state's learning capabilities
4. Test pause/resume of ongoing cycles

---

This completes the Project Sentinel implementation. The Guardian Agent is now fully functional with human-in-the-loop approvals, Git-based versioning, and interactive diff reviews.