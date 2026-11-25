# Poolday panel audit

An audit of every Poolday panel, dialog, sheet, menu and settings surface at
replo.id, made on 24 November 2026 from `main` at `b002443b6`. Each surface was
opened with Playwright at desktop (1440 × 900) and mobile (390 × 844) widths, in
light and dark themes. The second half records what changed: the choice
primitives in the [style guide](style-guide.md#choosing-the-right-control) and
the panels moved onto them.

The "Answer on" sheet was fixed separately in the same week (consistent computer
and model, no dead button, fixed height, Chats renamed Threads). This audit lists
its defects for completeness and builds on that fix.

## Summary

| Finding | Count |
|---------|-------|
| Choice controls catalogued | 50 |
| Wrong control, or the right control in an inconsistent form | 30 |
| Offering choices that cannot work now: not possible / partly possible | 7 / 5 |
| Disabled with no visible reason, or failing only after a click | 7 |
| Alignment defects | 16 |
| Layout shifts after first paint | 6 (4 measured, 2 by inspection) |

## Surfaces

| Surface | Where |
|---------|-------|
| Threads drawer | `/?view=threads`, `features/chat/presentation/ThreadsPanel.tsx`, `host/decisions/conversation-controller.js` |
| Conversation details drawer | `/?view=conversation`, `features/details/presentation/ConversationDetailsPanel.tsx`, `host/decisions/conversation-details.js` |
| Computers drawer | `/?view=computers`, `features/computers/presentation/ComputersPanel.tsx`, `host/decisions/computers.js`, `network-controls.js`, `contribution-models.js`, `operation-sharing.js` |
| Settings drawer | `/?view=settings`, `features/settings/presentation/SettingsPanel.tsx`, `host/decisions/settings.js`, `theme.js`, `remote-permission.js`, `web-search-settings.js` |
| Answer on sheet | composer model button, `features/chat/presentation`, `host/decisions/conversation-controller.js`, `conversation-model-picker.js` |
| Who can read it dialog | from the composer's privacy button, `privacy-controls.js` |
| Start sharing / Download model dialog | from a model to share or a local download, `host/decisions/conversation-controller.js` |
| Change model dialog | Contribute this computer, `contribution-models.js` |
| Remove download dialog | Settings, Storage |
| Import data dialog | Settings, Your data |
| Rename thread dialog | thread row |
| Owner pairing dialog | a `#pair=` link |
| Settings menu | the 7⁷ menu on Examples, Experiments, Changes, Records and Room-1 |

## Choice controls

Kinds: **one** (exactly one), **several**, **on/off**, **action**, **navigation**.
"Possible" says whether the options shown come from real capability and
availability (`inference.prepare` route rules, network answers, model and
route availability, the page's ports) or from a static list.

| # | Surface | Control | Kind | Was | Should be | Possible? |
|---|---------|---------|------|-----|-----------|-----------|
| 1 | Answer on | Computer (This device, Your desktop, Contributors) | one | `aria-pressed` buttons; chosen row a filled card, others plain text | single-select list | Partly: states came from state, but any computer could be paired with any model |
| 2 | Answer on | Model | one | hidden `select` plus grouped rows of two different looks | single-select list in groups | No: offered public-network models with This device chosen (the reported contradiction) |
| 3 | Answer on | Done | action | primary, inert when the pair could not run | primary that says what it does, or the reason and fix beside it | No |
| 4 | Answer on | "Ready · 1 computer" link beside a row | navigation | underlined link floating outside the row grid | status inside the row; computers reachable from Model details | Yes |
| 5 | Answer on | Switch to this device | action | ghost button that appeared and disappeared | the row's fix action | Yes |
| 6 | Answer on | Model details | disclosure | `pool-disclosure` | same | Yes |
| 7 | Who can read it | Presets | one | native radios above long bold titles and 6-line paragraphs | single-select list: title, one status line, the chosen preset's exposure below | No: confidential execution described as "Unavailable" rather than a planned target |
| 8 | Who can read it | Cancel / Apply | action | no Close in header; order differed from other dialogs | dialog shell footer: reason, Cancel, Apply | Yes |
| 9 | Threads | Active / Archived | one | `aria-pressed` buttons | segmented radio group | Yes |
| 10 | Threads | New thread | action | quiet button | same | Yes |
| 11 | Threads | Rename / Archive on a row | action | buttons | same | Yes |
| 12 | Rename thread | Save / Cancel | action | Save before Cancel, no header Close | dialog shell footer | Yes |
| 13 | Conversation details | Include app context | on/off | checkbox | toggle row | Yes |
| 14 | Conversation details | Word cap (16, 32, 64) | one | `select`, disabled with no reason when context is off | segmented radio group with the reason | Partly |
| 15 | Conversation details | Revoke a permission | action | secondary button | same | Yes |
| 16 | Conversation details | Download conversation, Save service receipt | action | quiet buttons | same | Yes |
| 17 | Computers | Connect a desktop (link or code) | action | form inside a disclosure inside a disclosure | one disclosure | Yes |
| 18 | Computers | Connect a native host | action | form in a disclosure | same | Yes |
| 19 | Computers | Public network | on/off | switch beside two stacked lines in a one-off row | toggle row | Yes |
| 20 | Computers | Show all computers / Show N others | disclosure | quiet buttons that change the list | same | Yes |
| 21 | Computers | Copy private invitation | action | quiet button | same | Yes |
| 22 | Computers | Answer requests | on/off | switch centred on a three-line block (title, paragraph, status) | toggle row; explanation as a caption below | Yes |
| 23 | Computers | Help peers connect | on/off | switch hidden inside a "Connection assistance" disclosure | toggle row | Yes |
| 24 | Computers | Model to share (production) | action | tile buttons in a wrapping row; the reason a model cannot be shared only in a tooltip | action rows with the reason on the row | Partly: disabled models gave no visible reason |
| 25 | Computers | Change model | navigation | quiet button opening a dialog | same | Yes |
| 26 | Computers | Specialized model jobs: model | one of many | `select` | same (long list) | Yes |
| 27 | Computers | Trust the publisher | consent | checkbox | same | Yes |
| 28 | Computers | Share this capability | action | primary, always enabled; failed with an error after the click until the approval was checked | primary disabled with the reason beside it until approved | No |
| 29 | Computers | Local name, Save name | action | form | same | Yes |
| 30 | Computers | Block / Unblock a computer | action | quiet button | same | Yes |
| 31 | Computers | GPU check, Save baseline | action | buttons; Save disabled until a measurement | same; the reason ("No measurement yet") is shown | Yes |
| 32 | Computers | Circle invitations: create, copy, revoke | action | buttons | same | Yes |
| 33 | Settings | Appearance (System, Light, Dark) | one | `aria-pressed` buttons; chosen segment drawn with the focus colour | segmented radio group; chosen segment raised, focus a ring | Yes |
| 34 | Settings | Route preference (Balanced, Faster, More reliable) | one | `select`; help text named a "Lower cost" option that no longer exists | segmented radio group | No: active with network answers off, when only one computer can answer |
| 35 | Settings | Refresh storage | action | full-width quiet button under the list | quiet button beside the storage status | Yes |
| 36 | Settings | Remove a download | action | quiet button opening a confirmation | same | Yes |
| 37 | Settings | Share model files | on/off | switch beside three stacked lines | toggle row | Yes |
| 38 | Settings | Model to share (files) | one of many | `select` | same (long list) | Yes |
| 39 | Settings | Files to share (Already downloaded, Within a limit, Full model) | one | `select` hiding what each mode downloads; disabled with no reason while sharing | single-select list with what each mode downloads | No: no reason while fixed; "Already downloaded" offered as sharing when nothing was downloaded |
| 40 | Settings | Download allowance | value | number field | same | Yes |
| 41 | Settings | Export my data / Import data | action | quiet text buttons | secondary buttons | Yes |
| 42 | Settings | Sign in, top up, spending limit, sign out | action | forms and buttons | same | Yes |
| 43 | Settings | Allow network answers | on/off | switch beside an `h3` in small type | toggle row | Yes |
| 44 | Settings | Web search | on/off | switch disabled with the reason inside a collapsed disclosure | toggle row with the reason on the row and an "Add server" fix | No: the reason was hidden |
| 45 | Settings | Search server: Save, Check server | action | raised Save then quiet Check | Check then Save, status reserved | Yes |
| 46 | Settings | Changes, Examples, Experiments | navigation | tall tiles, icon above text | action rows with a chevron (Settings menu keeps tiles) | Yes |
| 47 | Start sharing | Model | one of many | `select` | same | Yes |
| 48 | Start sharing | Answer requests / Share cached files | several | checkboxes above their labels | multi-select list | Partly: an unavailable option was disabled without a reason |
| 49 | Start sharing | Download & share | action | primary disabled during the size check, with the size line far above it | reason or size beside it in the footer, with Retry | Partly |
| 50 | Owner pairing | Connect / Done / Close | action | primary in the body; Close hidden inside Details | dialog shell: Close in header, primary in footer | Yes |

## Alignment defects

1. Answer on: the chosen row was a filled card with a check; the others were plain text with a subtitle, so rows had different heights and edges.
2. Answer on: a status link ("Ready · 1 computer") floated beside a row, outside the grid.
3. Who can read it: each radio sat on its own line above its title.
4. Who can read it: titles joined two ideas with a middle dot and wrapped to two bold lines.
5. Start sharing: checkboxes sat on their own lines above their labels.
6. Toggle rows: switches were centred on a three-line block, so they were off the title's line.
7. Toggle rows: the status line sat under a paragraph instead of under the title.
8. Segmented controls: the chosen segment used the focus colour, so it looked focused.
9. Badges ("Preparing connection"): a one-off rule removed their padding; their height followed the font.
10. Computer rows: the badge wrapped under the name on narrow widths.
11. Icons in labelled buttons sat on the text baseline, about 3 px low.
12. Section headings mixed sizes: "Inference" small, "Web search" subheading, "Answers" subheading.
13. Refresh storage: a full-width quiet button with its label inset, unlike every other action.
14. Panel headers scrolled away with the content in the Computers and Settings drawers.
15. Dialog chrome varied: 24 px padding with no header rule, Close present on two dialogs and absent on five, footer order Cancel-first on some and primary-first on others.
16. App shortcuts in Advanced were tiles of a different height from every other row.

## Layout shifts

Largest change of the dialog's bounding box after first paint, measured with
Playwright on a local server (reduced motion, so no entrance animation counts):

| Surface | Before | Cause |
|---------|--------|-------|
| Answer on (mobile) | grew 52 to 72 px as discovery returned | rows changed groups and heights as availability arrived |
| Who can read it | grew 36 px when its error appeared | the error line was `hidden`, so it took no space until shown |
| Remove download | grew 36 px when its error appeared | same |
| Import data | grew 36 px when its error appeared | same |
| Owner pairing (by inspection) | grows between request, waiting and result | the message line and connection detail appear |
| Computers drawer (by inspection) | content below moves as computers connect | readiness text and rows are inserted above the fold |

After the change every panel and dialog above, except "Answer on" (fixed
separately), keeps a 0 px box change in desktop and mobile widths:
`tests/e2e/poolday-layout-stability.spec.js` checks the four drawers, Who can
read it, the download and sharing dialog, and both confirmations, while data
loads and while choices change.

## What changed

### Primitives

Added to `primitives/choices.css`, with markup helpers in
`ui/components/choices.js` and rules in the style guide:

- single-select list (`pool-options` with radios) and multi-select list
  (`pool-options-multi` with checkboxes): one row shape of icon box, title,
  one status line, and a trailing check or fix at fixed positions;
- segmented control as a radio group (`label.pool-segment`);
- toggle row (`pool-toggle-row` with a `role="switch"`);
- action row (`pool-action-row`, with a chevron for destinations);
- disabled with a reason: the reason in the status line, always visible, and a
  fix in the trailing slot when one exists;
- status line (`pool-status-line`) and alternatives (`pool-reserve`) that keep
  their space; badges with a fixed height;
- dialog shell (`pool-dialog`, `-header`, `-body`, `-footer`, `pool-dialog-fixed`
  for live data) that becomes a bottom sheet on narrow screens;
- tokens for the alignment grid (`--pool-icon-*`, `--pool-row-*`, `--pool-line-*`)
  and row, list and dialog spacing.

### Choices from real flows

`ui/pool-home/choice-availability.js` derives the options:

- confidential execution is always disabled, and reads as a planned target:
  "Not available yet. Planned: no computer, not even the one answering, can read
  your prompt.";
- "Only your devices" names this device and the paired desktop, the computers that read the content;
- route preference is disabled with its reason while network answers are off,
  with a fix that opens that setting and does not change it;
- file modes say what each downloads, and say why they are fixed while files are shared;
- sharing options say why the page cannot share compute or files;
- web search says why it cannot turn on and offers adding a search server;
- a model that cannot be offered for sharing says why on its row;
- Share this capability stays disabled, with the reason, until its approval is checked.

### Before and after

Screenshots of every surface were taken before and after, at both widths and
in both themes; they are review evidence and are not stored in the repository.
The lasting checks are `tests/e2e/poolday-layout-stability.spec.js` (0 px box
change after first paint for the drawers and dialogs, and row icons, text and
trailing controls centred within 1 px), `tests/unit/choice-availability.test.js`
(option derivation) and `tests/unit/poolday-choices.test.js` (roles and markup).

*Last updated: November 2026*
