import 'dart:convert';

import 'package:core/core.dart';
import 'package:test/test.dart';

void main() {
  test('diagnostics cannot serialize failure causes or private text', () {
    const secret = 'sentinel-token-and-private-note';
    final failure = AppFailure(
      FailureKind.unavailable,
      cause: Exception(secret),
    );
    final events = <Map<String, Object>>[];
    Diagnostics(sink: events.add).record(
      DiagnosticEvent(
        operation: DiagnosticOperation.submit,
        outcome: DiagnosticOutcome.failed,
        failure: failure.kind,
        elapsed: const Duration(milliseconds: 25),
      ),
    );
    expect(jsonEncode(events), isNot(contains(secret)));
    expect(failure.toString(), isNot(contains(secret)));
    expect(
      events.single.keys,
      unorderedEquals(['operation', 'outcome', 'failure', 'elapsedMs']),
    );
    expect(() => events.single['payload'] = secret, throwsUnsupportedError);
  });

  test('sink failure does not break the operation', () {
    final diagnostics = Diagnostics(
      sink: (_) => throw StateError('sink failed'),
    );
    expect(
      () => diagnostics.record(
        const DiagnosticEvent(
          operation: DiagnosticOperation.read,
          outcome: DiagnosticOutcome.succeeded,
        ),
      ),
      returnsNormally,
    );
  });
}
