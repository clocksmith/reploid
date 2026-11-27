# Poolday UI architecture

**Status:** canonical contract for the React Poolday interface and its design system. Every route
is the React product; the vanilla interface has been retired, and the ratchet below is at zero.

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

## Layers and rules

This section is the canonical contract; `scripts/poolday-ui-architecture.json` is the checked
policy. Paths in `features/`, `app/` and `l10n/` are under `apps/poolday-react/src/`.

| Layer | Path | May import |
| --- | --- | --- |
| ui | `packages/poolday-ui/src/` | ui, `react`; may render markup, use platform globals and set `--pool-param-*` styles |
| domain | `features/<f>/domain/` | domain |
| application | `features/<f>/application/` (when a feature needs one) | domain, application |
| infrastructure | `features/<f>/infrastructure/` | domain, infrastructure, platform globals, the API bridge's public entries, `apps/poolday/host/` and `apps/poolday/pool/` |
| presentation | `features/<f>/presentation/` | ui, domain, application, presentation, l10n; from `react` only hooks, `createContext`, `memo` and `ReactNode` |
| composition | `app/`, `main-*.tsx` | every layer, `react`, `react-dom/client`, platform globals |
| l10n | `l10n/` | l10n |

Features never import each other; the composition layer joins them.

- **One library.** `packages/poolday-ui` (import `@reploid/poolday-ui`, nothing deeper) is the
  design system. Its components render the primitive classes over `tokens.css`; those
  stylesheets are the implementation and the single source of every value. No second component
  set, no page CSS.
- **Outside `packages/poolday-ui`:** no HTML elements (so no raw `button`, `input`, `select`,
  `textarea` or `a`), no `className`, `style` or `dangerouslySetInnerHTML`, no literal
  colours, sizes or durations, and no token names (only the design page, which documents the
  tokens, names them). **Inside it:** values come from tokens, and `style` may set only
  `--pool-param-*`. Tokens are read only by primitives; screens are composed of primitives.
- **Choice controls by decision** ([style guide](style-guide.md#choosing-the-right-control)):
  exactly one is `SingleChoice`, several is `MultiChoice`, on/off is `Toggle`.
- **The API bridge stays pure.** `packages/reploid/src` has no React, JSX, DOM rendering or
  presentation state, and every public entry has `.d.ts` types. Only infrastructure adapts it.

### Adding a primitive

1. Add the component to `packages/poolday-ui/src` and export it from `index.ts`.
2. Put any new look in a primitives stylesheet using tokens (`npm run verify:pool:css`).
3. Add it to `PRIMITIVE_ORDER` in `scripts/build-poolday-design-index.mjs`, a specimen in
   `apps/poolday-react/src/features/design/presentation/primitiveSpecimens.tsx`, and an
   interaction and accessibility test in `tests/unit/poolday-ui/components.test.tsx`.
4. Run `npm run build:browser-bundle`. The primitive then appears on `/design` with its tokens
   and compositions.

The checks a contributor runs are listed in [AGENTS.md](../AGENTS.md#poolday-design-system).

## What the checks enforce

`scripts/check-poolday-ui-boundaries.mjs`, adapted from clocksmith/react-starter
`tool/check_boundaries.mjs` (commit cd07713), parses every file and rejects:

- HTML elements, `className`, `style` or `dangerouslySetInnerHTML` outside `packages/poolday-ui`;
- literal colours (`#hex`, `rgb()`, `color-mix()` and the rest), sizes and durations in any layer;
- a `style` in the ui package that sets anything but `--pool-param-*` through an object literal;
- a layer importing a layer it may not, one feature importing another, a package not
  allowlisted for the layer, reaching past `@reploid/poolday-ui`'s entry, unresolvable or
  computed imports, cycles, symlinks and manifest drift;
- platform globals outside infrastructure and composition, and React beyond hooks, types and `memo`
  (so a message re-renders only when its own record changes) in presentation;
- for `packages/reploid/src`: React or design-system imports, JSX, markup writes
  (`innerHTML` and the like), DOM globals, and public entries without types; only
  infrastructure may import the bridge, and only its public entries.

`scripts/verify-poolday-ui-ratchet.mjs` counts the legacy interface (hand-written controls,
class attributes, composition classes and rules) against `scripts/poolday-ui-ratchet.json`
and fails if a count rises. `tests/unit/poolday-ui-checks.test.js` holds one failing fixture
per rule.

These are syntactic checks, not a sandbox. Review owns meaning; behaviour tests own correctness.
Do not add exemptions: move a boundary by changing the policy and this document together.

## The design page

`/design` (`apps/poolday/design.html`, `apps/poolday-react/src/main-design.tsx`; locally
`npm start`, then `http://localhost:8000/design`) is built only from the library.
`scripts/build-poolday-design-index.mjs` reads tokens, the components and the screens and
records who uses what; the page reads token values from the served `tokens.css`. It shows
tokens (raw scales, then semantic values per theme, with use counts and unused tokens marked),
then primitives from simplest to most complex, then compositions from small pieces to whole
screens. Each token lists the primitives that read it, and each primitive lists its tokens and
the compositions that use it. The Zero / X RD specimen is at `/x/design`.

## Current state

React is the only Poolday interface. `index.html` and `pool-entry.html` load one bundle,
`/ui/react/app.js` (built from `apps/poolday-react/src/main-app.tsx`), on every product route:
the conversation workspace on `/`, `/network` and `/work`, and the pages `/ask`, `/compute`,
`/records` (also `/history`), `/room-1`, `/improve`, `/examples` and `/experiments`
(`features/shell/domain/routes.ts`). `/design` loads `/ui/react/design.js`. The vanilla
shell and its composition stylesheets were deleted in `63eec5cbe`; no vanilla bundle is built
or served.

`main-app.tsx` exports `initPoolHome(root, { signal })`, the entry contract the HTML pages
call, and `mountPoolday(root, { host, viewState })`, which the browser journeys use to mount the
product on a fixture host.

The screens render records and send commands. Routing, consent and receipt decisions stay
framework-free in `apps/poolday/host/decisions/` and the host; `apps/poolday/ui/pool-home/` keeps
only framework-free projections and wording those decisions read. The conversation controller
(`conversation-controller.js`) owns drafts, "Answer on", "Who can read it?", the queued Send,
the reviewed download, threads and the transcript. The transcript keeps each message's record
until that message or its attempt changes, so an update costs the same with 2 threads or 30
(`tests/unit/poolday-conversation-controller.test.js`).

`scripts/poolday-ui-ratchet.json` records zero for every count (raw controls, class
attributes, composition classes and rules). The ratchet may only go down, so any markup written
outside `@reploid/poolday-ui` fails `npm run verify:poolday-ui`.
