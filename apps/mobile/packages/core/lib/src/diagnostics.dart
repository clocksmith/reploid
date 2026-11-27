import 'failure.dart';

enum DiagnosticOperation { sessionTransition, read, refresh, submit }

enum DiagnosticOutcome { succeeded, failed, cancelled }

/// Intentionally accepts no free text, identifiers, URLs, or payloads.
final class DiagnosticEvent {
  const DiagnosticEvent({
    required this.operation,
    required this.outcome,
    this.failure,
    this.elapsed,
  });

  final DiagnosticOperation operation;
  final DiagnosticOutcome outcome;
  final FailureKind? failure;
  final Duration? elapsed;

  Map<String, Object> toJson() => Map.unmodifiable({
    'operation': operation.name,
    'outcome': outcome.name,
    if (failure != null) 'failure': failure!.name,
    if (elapsed != null) 'elapsedMs': elapsed!.inMilliseconds,
  });
}

typedef DiagnosticSink = void Function(Map<String, Object> event);

/// A failing diagnostic sink cannot interrupt a user operation.
final class Diagnostics {
  const Diagnostics({this.sink});

  final DiagnosticSink? sink;

  void record(DiagnosticEvent event) {
    try {
      sink?.call(event.toJson());
    } catch (_) {
      // Logging its own failure could recurse or expose the sink's payload.
    }
  }
}
