# Rail containment, shared chat column, and marble switches

Component: browser conversation presentation. Intent preserved. No runtime, grant, chat execution, catalog, or public pin changes. These controls use injected presentation state, no inference or GPU device.

## Broken boundaries reproduced

- Live `https://replo.id` desktop: 60px rail, 42px inner width, but model/actions buttons reach54px. Shared material padding and grid intrinsic width overflow the rail. Brand/settings controls also differ44/48px. Raw measurements and live screenshots: `live-before.json`, `live-before-*.png`.
- Live900px viewport: composer/stream stayx92,width716 in every panel state. Expanded rail occupiesx16..286 orx561..876. The `max-width:1000px` rule hardcodes collapsed gutters. `column-before.json` records collapsed,left,both,right at1440/900/390. `before-test.txt` and `column-before-test.txt` preserve independent failing containment/column checks.
- Switch thumb previously used the existing theme marble gradient (07907105); a later change replaced it with flat fills. Restore that recipe and reduce the light highlight fromwhite to#c8c8c8, keeping the dark recipe unchanged.

## Repair and acceptance

Four production files are in `ui-only.patch`. Uniform44px collapsed controls fit border-inclusive rails. Both inverse glyph arrangements remain stationary, with equal explicit superscript offsets. Tablet column gutters follow actual panel widths; phones retain overlay panels. Transcript scroll owner and message-width element are the same node, sharing the composer width (existing48rem maximum;720px in the live configuration). Width-only ResizeObserver resizes wrapped draft input without window resize and is disconnected on disposal.

`settled-test.txt`: all19 Chromium controls pass, including actual Verification Worker. Light/dark at1440/900/390/320; left/right/both/collapsed transitions; overflowing transcript; exact aligned edges;44px usable composer controls; preserved drafts; mobile overlay; stationary glyphs; keyboard focus; marble on/off/disabled; reduced motion. `unit-tests.txt`:31 existing conversation/message/permission/admission controls pass. Types,charters,CSS layers also pass.

Retained test-development failures are not relabeled as product regressions: `final-test.txt` used mouse→programmaticfocus rather than keyboard modality; `keyboard-test.txt` incorrectly expected duration0s despite the RD reduced-motion0.01ms override; `keyboard-verified-test.txt` and `disabled-{inspect,rules}.txt` sampled opacity before the next animation frame. Matching disabled selector and both0.444 tokens were observed; final check waits for that computed style. A visual review also caught the stronger collapsed-button selector exposing mobile New thread; the final mobile rule and explicit hidden-control regression restore prior behavior. `final/` contains selected earlier screenshots showing that finding; `accepted-test.txt` retains the first mobile-hide specificity failure (run interrupted after failure, before completion); `settled/` is the final source.

The patch is intended for an isolated overlay on accepted public source38c04a5f. Parent owns actual overlay verification, generated bundle, hosting deployment and live post-deploy receipts. This source checkpoint does not claim deployment.
