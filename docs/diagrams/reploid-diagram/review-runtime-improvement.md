# Runtime improvement diagram review

Component: Reploid documentation (`docs/CATSCAN.md`).
Intent: preserved.
Acceptance evidence: `test/unit-results.txt`, `test/browser-results.txt`; commands below.
Boundary effects: documentation viewer and its additive reference schema only. No runtime engine, evaluator, adoption grant, package API or product qualification changes.

## Inspected

Baseline: Reploid `49425e01e72d201168723290b20473d4a22f7a44`.
The review reads `GOALS.md`, `docs/work-collaboration.md`,
`docs/rsi-improvement-episodes.md`, and
`artifacts/continuing-improvement-2026-09-20/report.json`.
Cross-project links identify Doppler `473bb358` architecture and Doe `89ecba41` goals.

Reploid owns improvement during authorized product operation. Work documents
bounded replacement of registered pure tools, protected host evaluation,
separate adoption, pinned active tasks, retained failures and rollback.
Zero/X improvement episodes remain a distinct internal lane. Peer delivery
does not transfer the sender's evaluation or adoption authority.

The retained report records fixture-based improvements separately from unsuccessful
model-generated repair attempts. Independent-recipient adoption, unfamiliar-task
transfer and causal recursion are not established by this diagram or its tests.

## Changed

The canonical `diagram.json` adds the Evolve view for Reploid's own lifecycle.
The existing Improve view retains both cross-project loops and identifies them
as implementation improvement. The product, provider-alternative, independent
consumer and native/browser adoption views remain in place.

The inspector links each improvement view to owning contracts and distinguishes
intent, documented implementation and retained evidence. Links require HTTPS
without credentials and are not fetched by importing JSON. The optional
`references` field is additive to `box-arrow-diagram/v1`.

`index.html` and SVG exports are regenerated from the canonical source.
The runtime-loop screenshot was visually inspected for labels, routes and bounds.

## Executed

From this diagram directory:

```sh
npm run build
npm test
/tmp/reploid-diagram-venv/bin/python test/browser_check.py
node --check source/core.mjs
node --check source/viewer.js
node --check source/three-renderer.mjs
```

From the repository root: `npm run verify:catscan` and `git diff --check`.
All final commands pass. The browser check uses Python Playwright `1.58.0`
in an isolated temporary environment and Chromium's offline SVG path.
The initial system Python lacked Playwright; the first browser attempt after
installation targeted empty space inside an SVG group's bounds. The corrected
test clicks the visible edge label, then checks the inspector's links.

Product inference, improvement episodes, model-generated candidates, peer
adoption, Three.js/WebGL rendering, deployment and performance experiments
were not rerun. Existing outcome evidence retains its original source and scope.

*Last updated: September 2026*
