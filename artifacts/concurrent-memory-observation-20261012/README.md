# Concurrent fixture memory observation repair

CPU preparation for the existing simultaneous 1,588-token test found that its memory assertion demanded `device.lost`, a field absent from Doppler's actual `inspectDeviceMemory` snapshot. The frozen preparation observer already retains device loss/uncaptured errors in `deviceEvents` and read failures in `observationErrors`; snapshots follow a completed queue barrier.

The fixture now requires both observed arrays to exist and be empty. It preserves the unchanged device ceiling, two live attempts, submitted cancellation, unchanged survivor tokens, retained weights and explicit fresh retry checks. The regression fixture now matches the actual snapshot shape rather than inventing `lost:false`.

Before-fix failure and after-fix 7 passing CPU controls are retained, including device loss, missing observation and failed observation rejection. Actual Verification Worker passed with no errors and one tooling warning. This is fixture validation, not physical concurrency evidence; the next physical run uses the unchanged standard 0.6.28 archive.

Component: verification evidence. Intent: preserved. Boundary effects: fixture observation schema only, no production runtime or allocation policy change.
