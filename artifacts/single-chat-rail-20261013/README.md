# Single chat rail — 2026-10-13

Component: Poolday conversation workspace and network inspector.
Intent: deliberately changed from two rails to one at the user's request.
Boundary effects: UI composition only; existing session, permissions, runtime and public package pin preserved.

Four consistently centered 44px controls share one left rail: threads, new chat,
model and network. Threads and network use the same expandable panel. The message
stream and composer retain one width and recenter together. Settings remain in the
network panel; marble switches retain their existing behavior. Keyboard focus,
Escape, New chat and navigation away/back preserve the existing controls and drafts.

## Acceptance

- Source Chromium: 19 cases pass in `final.txt`; the two shared-shell cases then
  pass in `shared.txt` after correcting the fixture's theme-selector parent.
- Frozen public-base overlay: the same 19 pass in `candidate.txt`, and both corrected
  shared-shell cases pass in `candidate-shared.txt`.
- 51 focused unit cases pass in `unit-final.txt`; CSS layers, library types and
  component charters pass. Chromium includes the actual Verification Worker.
- Coverage: both themes; 1440/900/390/320px; four centered controls, contrast,
  shared column geometry, reduced motion, keyboard dismissal, marble toggles,
  New chat, model focus, settings and shared-shell route restoration.
- `before.txt`, `after.txt`, `verified.txt` retain rejected layouts and the focus
  failure that led to revealing the dialog ancestor before opening it. The two
  shared-shell theme failures in `final.txt`/`candidate.txt` were fixture errors,
  corrected independently; they are not passing results.

No inference, GPU qualification, physical-phone keyboard or broader release
acceptance is claimed. The isolated deployment overlays the accepted public base,
including the prior rail/column repair, rather than promoting newer runtime work.
See `deployment/input.json` and the deployment receipt for exact served identities.

## Handoff

UI request only. Agent assistance has ended; runtime work is not resumed.
After hosting verification, stop this thread. Broader runtime milestones remain
in the canonical TODO and retain their existing acceptance status.
