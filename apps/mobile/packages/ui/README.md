# ui

Flutter components using Material theme roles and app-provided strings. Has no core, account, repository, or Riverpod dependency.

- `createUiTheme`: Material 3 theme from an app-owned seed, brightness, and optional font family. Shared rounded shapes, typography hierarchy, and hover/pressed/focus states apply to buttons, fields, cards, and navigation. Apps bundle their chosen fonts.
- `UiSpacing`: replaceable layout roles via ThemeExtension (16px gap, 24px inset, 760px maximum width).
- `ContentArea`: constrained content width and semantic padding.
- `ActionButton`: app-owned pending state, disabled duplicate interaction, wrapping labels.
- `AsyncContent`: retain confirmed content during refresh and recoverable failure.
- `PageSurface`, `Section`, `ContentCard`, `ActionGroup`: shared page structure, spacing, and responsive action layout.
- `SectionHeading`, `BodyCopy`, `StatusBadge`: semantic content roles without feature decisions.
- `ActionTile`, `SecondaryAction`, `NoteInput`: reusable interactions receiving data and callbacks.

Apps provide loading, retry, failure, and button labels from their localization catalog. AsyncContent accepts already-mapped safe messages; it never renders an exception. PageSurface scrolls long content. Session gates, private navigation, and account cleanup belong to app composition. The example supplies its own SessionGate; ui no longer exports it.

These components implement presentation behavior. Repositories must still coalesce duplicate commands and enforce data ownership. Run `flutter test` from this directory.
