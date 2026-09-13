# Separate browser consumer

This fixture imports only the packed package's public entry names. It does not
import self/, run a Reploid server or modify Simulatte. The deterministic model
port is a lifecycle demonstration, not evidence of model intelligence.

Build and install after authorizing package acceptance:

```sh
mkdir -p artifacts/npm
npm pack ./packages/reploid --pack-destination artifacts/npm
cd examples/library-consumer
npm install --ignore-scripts
```

Serve this directory with a static HTTP server and open index.html. This fixture
has been authored, not executed as acceptance evidence.
