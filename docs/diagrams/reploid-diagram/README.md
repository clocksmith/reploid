# Reploid · Doppler · Doe: JSON diagram and renderer

`diagram.json` is the canonical editable document. It contains three views:

1. **Ecosystem:** precisely A—B and B—C, with undirected mutual-benefit edges. No A—C relationship is asserted.
2. **Interfaces:** the selected Reploid stack uses Doppler; Doe is an optional WebGPU integration. Opposite arrows explicitly carry results and diagnostics rather than implying reciprocal software imports.
3. **One operation:** a whole-request example with optional Doe execution, results, failure reporting, cancellation settlement and authorized recovery. This is not a diagram of a qualified distributed layer split.

The content describes the supplied **intended architecture**, not newly audited implementation or performance. Poolday belongs inside Reploid's network responsibility. Search policy stays with the application. Rig / ModelIR / TargetPlans / Capsules / Run use the terminology in the supplied description.

## Immediate preview

Open `index.html`. Its default document and SVG rendering code are embedded, so the SVG view does not require a server, network access or installed packages. Some browser security policies may prohibit opening local HTML files; the local server is an alternative.

Drag a box to move it, drag the background to pan, and use the wheel or zoom controls. Click a box or edge for details. The A—B / B—C edge details link to their interface view and operation example. Edit or load JSON, then export JSON or SVG. Layout edits are in memory until exported; nothing edits Reploid, Doppler or Doe repositories.

## Three.js renderer

```sh
npm install
npm start
```

Open `http://localhost:8080`. For another port, use `PORT=8765 npm start`.

The server loads the exact declared dependency `three@0.180.0` from local `node_modules/three/build/`, under `/vendor/three/`. It makes no CDN requests. Dependency installation requires registry access; rendering after installation does not.

Three.js draws boxes, edge lines, arrowheads and depth. SVG text remains on top for readable labels and accessible interaction. An orthographic camera preserves the diagram coordinates. The renderer is WebGL-based; using it does not exercise Doppler's WebGPU inference.

If the dependency or WebGL is unavailable, the same document stays usable in SVG and the renderer indicator says SVG. The engine button retries or switches implementations. This is an explicit graphics fallback, not simulated Three.js execution.

## JSON contract

This is a small custom `box-arrow-diagram/v1` schema. It is **not** Three.js ObjectLoader JSON and does not run through `ObjectLoader.parse()` directly. `source/three-renderer.mjs` maps the data to geometry. It can also be adapted to Cytoscape, React Flow, SVG, Graphviz or another diagram renderer, but those adapters are not included.

Coordinates use top-left origin: `x` increases right, `y` increases down. A node's `x,y` is its upper-left corner. Sizes and line widths are diagram units, then scaled by the viewport.

```json
{
  "id": "A-B",
  "source": "A",
  "target": "B",
  "type": "symbiosis",
  "label": "Requests + experience\nInference + contracts",
  "sourceAnchor": { "side": "right", "offset": 0.5 },
  "targetAnchor": { "side": "left", "offset": 0.5 }
}
```

`source` and `target` identify geometric endpoints. They do not alone make the edge directed. `edgeTypes[type].arrow` determines direction: `none`, `target` or `both`. For a reverse arrow, reverse the endpoints. Mutual benefit deliberately has **no arrowheads**.

`edgeTypes[type].stroke` is `solid`, `dashed` or `dotted`. Required dependencies, optional integration, and information flows have separate legend entries. Labels and details explain what actually crosses a boundary.

Graph edges route from box anchors, with optional explicit `waypoints`. `labelPosition` controls the label independently. Sequence edges use `y` for their chronological row and connect the participants' lifeline centers.

`entities` holds reusable ownership and independence descriptions. View-specific `nodes` reference an entity and specify layout. `contractView` / `exampleView` are local view references, not fetched URLs or claims of actual exported APIs.

`schema.json` is a JSON Schema description. `validateDocument()` also checks unique IDs, referential integrity, numerical bounds and known styles. Labels are escaped, not interpreted as HTML. JSON is never evaluated as code. Untrusted graph data does not fetch assets.

## Files

```text
index.html                  Generated interactive preview
 diagram.json               Canonical full document
 ecosystem.json             Standalone ecosystem document
 schema.json                Format description
 source/core.mjs            Validation, routing, SVG export
 source/three-renderer.mjs   Three.js geometry adapter
 source/viewer.js            Editing and viewport interaction
 source/page.html            HTML/CSS template
 build.mjs                  Regenerate the embedded preview
 server.mjs                 Read-only loopback server
 test/diagram.test.mjs       Data and geometry tests
 test/browser_check.py       Browser interaction checks
 ecosystem.svg              Static export
 interfaces.svg             Static export
 sequence.svg               Static export
```

When served, the viewer reads `diagram.json`. After editing canonical files, `npm run build` regenerates the standalone embedded copy. `npm start` runs that build automatically. No build tool is required beyond Node for this step.

## Validation performed

- 16 Node tests passed: document validation, edge semantics, endpoint routing, escaping and SVG exports.
- Browser checks passed using the embedded page in Chromium: all three views, inspector navigation, invalid JSON rejection, node dragging, JSON/SVG downloads, and mobile width. No uncaught page errors occurred in that path.
- JavaScript syntax checks passed, including the Three.js adapter.
- **The Three.js/WebGL path was not executed in the authoring environment because its dependency could not be downloaded.** Install the pinned dependency and inspect the engine indicator locally. The shipped static SVGs and SVG interactions were inspected; that is not a WebGL execution claim.

## Primary documentation used for the renderer

- https://threejs.org/manual/pages/installation.html
- https://threejs.org/docs/pages/OrthographicCamera.html
- https://threejs.org/docs/pages/ShapeGeometry.html
- https://threejs.org/docs/pages/WebGLRenderer.html
- https://github.com/mrdoob/three.js/releases/tag/r180

Three.js is a separate dependency with its own MIT license. No font assets or model weights are bundled.
