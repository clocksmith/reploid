# Accepted runtime cleanup: read-only ownership trace

Input: `../cleanup-failure-20261012/result.json`, accepted Doppler archive
`9280ead598b098f9f3ad49574a001e88c3ad4b1a433d58349e79ee0e9c01fccc`.
No GPU run or source modification was made for this review.

After the successful retried close, the receipt contains exactly 64 surviving
buffers across 62 labels: 47,535,360 weight-labeled bytes and 10,486,016 other
bytes. The accepted pool's default `maxTotalPooledBuffers` is 64. The remaining
other labels are four RoPE tables totaling 10,485,760 bytes and a 256-byte
precompute uniform. Device labels describe original allocations, not current
application ownership.

The accepted close chain is resident `close()` → program close → pipeline
`unload()` → loader `unload()`. The loader releases tracked weight buffers
through `BufferPool.release()`. The last RoPE lease similarly releases its
tables. `release()` removes a buffer from active ownership, then retains it in
a reusable bucket until the configured limits require deferred destruction.
It does not erase the original device allocation label. Consequently, weight
labels remaining after close do not by themselves demonstrate resident leaks.

This source trace, the exact 64-buffer count and stable replacement allocation
are consistent with reusable pool retention. They are not a retrospective
measurement of the pool's private sets. The retained receipt lacks those sets,
so unresolved active ownership cannot be excluded from this evidence alone.
No speculative cleanup patch is justified by this receipt.

For the next already-required candidate run, capture the same device's
`getBufferPool(device).getStats()` and `getLabelStats()` alongside
`inspectDeviceMemory()` at ready, rejected close, successful retry, replacement
ready and replacement close. Also capture after queue settlement. The existing
stats distinguish `retainedModel`, `active`, `reusable` and `deferredCleanup`.
All-pool retention predicts zero active/retained/deferred bytes and 58,021,376
reusable bytes in this exact idle control. Capture a pre-open baseline to
separate unrelated device owners. Do not clear the pool to manufacture a zero
before recording ownership. A diagnostic CDP lexical observation can access
the existing pool; it is not an added application public API. The accepted
tooling surface exports device access but does not export the pool getter.

Reviewed installed source SHA-256:

- `src/loader/doppler-loader.js`:
  `864591d7df0405e1342eb8f6244d4c74ea9a42ce2c531186e9ff48890a4a5bde`.
- `src/memory/buffer-pool.js`:
  `6dd5d04cd8f6d16c15753fa6c6152a5b4a9f48bb4dcdb670f536f889ae351b80`.
- `src/inference/pipelines/text/init-rope.js`:
  `34c76845bfa2e6bac061810152487b3a0d4a8ee85eeac4c57208ab11244f03f3`.
