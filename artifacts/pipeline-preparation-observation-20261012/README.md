# Pipeline preparation observation

The active native 0.6.28 first-prefix check reached the layer12 convolution submission but retained no shader or pipeline preparation boundaries. Its existing snapshot is unchanged. The next operation in the exact archive is `gated_delta_recurrent/paired`, but the old evidence cannot distinguish shader preparation from pipeline preparation or later host work.

This inactive fixture revision adds start, API completion and rejection records for `createShaderModule`, `getCompilationInfo`, `createComputePipeline` and `createComputePipelineAsync`. A bounded 128-event history and separate pending-operation list appear in `memorySnapshot`. API completion does not mean successful GPU execution; compilation-info resolution may contain diagnostics. No kernel, provider, arithmetic, reference, timeout or allocation policy changes.

Native return objects, original promises, rejections and synchronous exceptions remain identical. An observation-installation failure is recorded separately and cannot replace a successful native return. Existing pipeline metadata and submission observations remain available.

The focused regression fails against the old fixture. Seven controls across three test files pass after the patch, including deferred completion, preserved promise/error identity, retained pending operations after history truncation, observation failure, device loss and queue failure. The actual Verification Worker passes with 16 warnings and no errors. These are CPU/sandbox controls, not physical qualification.

`freeze.json` binds the new observer bytes separately. A future diagnostic snapshot must include them in its own delivery binding before launch; this receipt does not authorize mutation of the current native run or transfer its observations retrospectively.

Component: verification evidence. Intent: preserved. Boundary effects: test-only browser/native observation; none to installed Doppler runtime or application pins.
