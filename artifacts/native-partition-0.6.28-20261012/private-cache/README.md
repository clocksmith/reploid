# Private Mesa cache diagnostic

The frozen19-token Mac-browser input / AMD-Node output control completed both
prefixes and EOS. Errors against the approved F64 vectors were8.3996474e-7 and
6.1575201e-7. It used unchanged standard0.6.28 archive102fd0c4 and corrected native
application32fa4e3f. This is a short numerical diagnostic, not native full55,
concurrent1588, signed opening, or ordinary application qualification.

The initially empty private Mesa disk-cache condition reproduced a large delay:
first output arrived917.963seconds after controller start (log mtime917.802s),
including80.751s until both residents were ready. First output followed the
ready log by838.011s. The paired recurrent `createComputePipelineAsync` alone
took746.423s, versus15ms in the preceding retained-cache repeat. Its shader
module and compilation-info calls had already completed. All42 preparation
operations eventually completed, without observed device loss or validation
errors. These observations identify the slow API boundary; they do not separate
Dawn translation from RADV compiler work.

Only native `MESA_SHADER_CACHE_DIR` changed. The actual child environment was
verified before provider opening, the directory was empty and private, and the
actual loaded Dawn/RADV hashes matched the freeze. The cache gained files and
is preserved. Shared caches were neither cleared nor changed; other caches are
not asserted cold. [Mesa documentation](https://docs.mesa3d.org/envvars.html#envvar-MESA_SHADER_CACHE_DIR)
defines the variable. Existing document CPU work on cores4–7 continued, so this
is a controlled diagnostic, not an exclusive performance benchmark.

Maximum observed process RSS was9,789,652,992bytes; sampled process high-water
was9,902,841,856bytes. These are distinct from GPU buffer allocation peaks:
693,112,784bytes on Mac and330,557,184bytes on AMD, both under1.42billion. Both
resident queue barriers completed; active/deferred buffers and retained weight
bytes were zero. Reusable pool bytes remained until provider disposal. The
owned native provider released and PID1714510 exited naturally with status0.
Controller status was0. Only owned servers/tunnel were then stopped. Public
contributors and their shared caches were untouched.

The20-minute diagnostic operation bound and ordinary300-second stage deadline
were unchanged. Thus this run passed short numerical correctness but failed
ordinary cold responsiveness. The original916.5-second result remains retained.
A post-shutdown inspector fetch failure is preserved separately; it occurred
after controller/provider settlement. All bound fixture files and installed
runtime bytes were independently reverified afterward on both hosts.

The separately committed Doppler readiness repair0ac64fa2 prepares the exact
paired convolution/recurrent pipelines before resident readiness and preserves
abort settlement. It was not used in this run and requires its own frozen
candidate and physical validation. It does not claim full-program preparation
or a compiler-speed improvement.
