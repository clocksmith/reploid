enum FailureKind {
  unavailable,
  validation,
  conflict,
  forbidden,
  unauthenticated,
  sessionExpired,
  unexpected,
}

/// A safe category for presentation. [cause] must never be serialized to logs.
final class AppFailure implements Exception {
  const AppFailure(this.kind, {this.cause});

  final FailureKind kind;
  final Object? cause;

  @override
  String toString() => 'AppFailure(${kind.name})';
}
