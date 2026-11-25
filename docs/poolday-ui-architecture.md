# Poolday UI architecture

**Status:** canonical contract for the React Poolday interface and its design system. The legacy
vanilla interface under `apps/poolday/ui/pool-home` is being retired screen by screen; until a
screen moves, it stays as it is and the ratchet below keeps it from growing.

## Assessment: React on the react-starter layout, or a componentized vanilla system

Decided 2026-11-25 for the owner's direction that the UI use only design-system components.

| Question | Componentized vanilla (template strings) | React on the react-starter layout |
| --- | --- | --- |
| Enforceability | Markup is text inside strings; a check can only pattern-match it, and an escaped attribute or a `createElement` call slips past | JSX is syntax: a parser rejects any HTML element, `className`, `style` or injected markup outside the ui package, deterministically |
| Architecture | One markup sink (`setPoolHtml`) plus hand-written node updates and focus bookkeeping per view (17.7k lines in `pool-home`) | Components own their markup and focus; screens are props in, callbacks out; state reaches them through hooks |
| Bundle | No framework | React 19 and `react-dom/client`: the `/design` entry, with the library and every composition, is 371 kB minified and 100 kB gzipped |
| Migration risk | Low per change, but nothing stops new bespoke markup | A rewrite risk, contained by moving one screen at a time behind the real routes with the e2e journeys as the parity bar |
| Behaviour parity | Unchanged | Kept by stable `data-*` hooks the journeys use and by reusing the host's decisions (`describeAnswerChoice` and the rest) rather than re-deriving them |

React wins on enforceability, which is the owner's requirement, and simplifies each screen.
The bridge, the host and the runtime do not move.

## Layout

- `packages/poolday-ui` (`@reploid/poolday-ui`): the design system. Components emit the primitive
  classes of `apps/poolday/styles/poolday/primitives/*.css`; tokens stay in `tokens.css`. No
  value is restated in TypeScript.
- `apps/poolday-react/src`: features in layers (`domain`, `application` when needed,
  `infrastructure`, `presentation`), `l10n` for every visible string, and `app/` plus
  `main-*.tsx` for composition. Builds land in the served tree as `apps/poolday/ui/react/*.js`
  (`scripts/build-product-entry.js`), checked by `npm run verify:browser-bundle:local`.
- `packages/reploid/src`: the API bridge. Framework-free, typed by its `.d.ts` entries.

Who may import what is in [AGENTS.md](../AGENTS.md#poolday-design-system) and, as checked
policy, `scripts/poolday-ui-architecture.json`.

## What the checks enforce

`scripts/check-poolday-ui-boundaries.mjs`, adapted from clocksmith/react-starter
`tool/check_boundaries.mjs` (commit cd07713), parses every file and rejects:

- HTML elements, `className`, `style` or `dangerouslySetInnerHTML` outside `packages/poolday-ui`;
- literal colours (`#hex`, `rgb()`, `color-mix()` and the rest), sizes and durations in any layer;
- a `style` in the ui package that sets anything but `--pool-param-*` through an object literal;
- a layer importing a layer it may not, one feature importing another, a package not
  allowlisted for the layer, reaching past `@reploid/poolday-ui`'s entry, unresolvable or
  computed imports, cycles, symlinks and manifest drift;
- platform globals outside infrastructure and composition, and React beyond hooks and types in
  presentation;
- for `packages/reploid/src`: React or design-system imports, JSX, markup writes
  (`innerHTML` and the like), DOM globals, and public entries without types; only
  infrastructure may import the bridge, and only its public entries.

`scripts/verify-poolday-ui-ratchet.mjs` counts the legacy interface (hand-written controls,
class attributes, composition classes and rules) against `scripts/poolday-ui-ratchet.json`
and fails if a count rises. `tests/unit/poolday-ui-checks.test.js` holds one failing fixture
per rule.

These are syntactic checks, not a sandbox. Review owns meaning; behaviour tests own correctness.
Do not add exemptions: move a boundary by changing the policy, this document and AGENTS.md together.

## The design page

`/design` (`apps/poolday/design.html`, `apps/poolday-react/src/main-design.tsx`) is built only
from the library. `scripts/build-poolday-design-index.mjs` reads tokens, the components and the
screens and records who uses what; the page reads token values from the served `tokens.css`.
The Zero / X RD specimen is at `/x/design`.

## Migration status

Every product route still runs the vanilla shell. `/design` is the first page built from the
library. The conversation, Answer on, thread, Computers, Settings and Connect a desktop screens
exist as compositions on `/design`, driven by synthetic records; none is wired to a product
route yet. Each moves behind its real route in its own change, with the e2e journeys as the
parity bar, and `/` stays on the vanilla shell until the owner switches it.

| Screen | React (`@reploid/poolday-ui`) | Product routes |
| --- | --- | --- |
| `/design` | Whole page | |
| Conversation: transcript, receipts, composer | Composition on `/design` | Vanilla |
| Answer on and the reviewed download | Compositions on `/design` | Vanilla |
| Threads | Composition on `/design` | Vanilla |
| Computers, Settings, Connect a desktop | Compositions on `/design` | Vanilla |

`scripts/poolday-ui-ratchet.json` records what remains in the vanilla interface; it falls as
each vanilla screen is deleted after `/` moves.
