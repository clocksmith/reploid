import 'dart:async';

import 'diagnostics.dart';
import 'failure.dart';

final class SessionIdentity {
  const SessionIdentity(this.accountId, {this.tenantId});

  final String accountId;
  final String? tenantId;

  @override
  bool operator ==(Object other) =>
      other is SessionIdentity &&
      other.accountId == accountId &&
      other.tenantId == tenantId;

  @override
  int get hashCode => Object.hash(accountId, tenantId);
}

/// Equality is scoped to a coordinator instance as well as its generation.
final class SessionKey {
  SessionKey._(this.identity, this.generation, this._owner);

  final SessionIdentity identity;
  final int generation;
  final Object _owner;

  @override
  bool operator ==(Object other) =>
      other is SessionKey &&
      identical(other._owner, _owner) &&
      other.generation == generation &&
      other.identity == identity;

  @override
  int get hashCode => Object.hash(_owner, generation, identity);
}

typedef SessionCleanup = FutureOr<void> Function();

/// A revocable capability. Check after each await before publishing or mutating.
final class SessionHandle {
  SessionHandle._(this.key);

  final SessionKey key;
  final List<SessionCleanup> _cleanups = [];
  bool _active = true;
  Future<void>? _closing;

  bool get isActive => _active;

  void requireActive() {
    if (!_active) throw const AppFailure(FailureKind.sessionExpired);
  }

  void registerCleanup(SessionCleanup cleanup) {
    requireActive();
    _cleanups.add(cleanup);
  }

  void _revoke() => _active = false;

  Future<void> _close() {
    _revoke();
    return _closing ??= _drain();
  }

  Future<void> _drain() async {
    Object? firstError;
    final pending = List<SessionCleanup>.of(_cleanups.reversed);
    _cleanups.clear();
    for (final cleanup in pending) {
      try {
        await cleanup();
      } catch (error) {
        firstError ??= error;
        _cleanups.add(cleanup);
      }
    }
    _closing = null;
    if (firstError != null) {
      throw AppFailure(FailureKind.unexpected, cause: firstError);
    }
  }
}

enum SessionStatus { signedOut, transitioning, ready, failed, closed }

final class SessionState {
  const SessionState._(this.status, {this.session, this.failure});

  final SessionStatus status;
  final SessionHandle? session;
  final AppFailure? failure;
}

/// Owns the account boundary, not a backend's authentication protocol.
///
/// Transitions revoke synchronously, serialize cleanup, and publish only the
/// latest request. Register resources (including credential cleanup) on the
/// handle. App adapters must guard late authentication and storage effects.
final class SessionCoordinator {
  SessionCoordinator({this.diagnostics = const Diagnostics()});

  final Diagnostics diagnostics;
  final Object _owner = Object();
  final _events = StreamController<SessionState>.broadcast(sync: true);
  SessionState _state = const SessionState._(SessionStatus.signedOut);
  SessionHandle? _current;
  Future<void> _tail = Future.value();
  Future<void>? _disposing;
  int _generation = 0;
  bool _disposed = false;

  SessionState get state => _state;

  /// Replays current state and delivers subsequent transitions to each reader.
  Stream<SessionState> watch() => Stream.multi((controller) {
    final subscription = _events.stream.listen(
      controller.addSync,
      onDone: controller.closeSync,
    );
    controller.addSync(_state);
    controller.onCancel = subscription.cancel;
  });

  Future<void> activate(
    SessionIdentity identity, {
    Future<void> Function(SessionHandle session)? prepare,
  }) => _transition(identity, prepare);

  Future<void> signOut() => _transition(null, null);

  Future<void> _transition(
    SessionIdentity? identity,
    Future<void> Function(SessionHandle)? prepare,
  ) {
    if (_disposed) throw StateError('SessionCoordinator is closed');
    final generation = ++_generation;
    _current?._revoke();
    _publish(const SessionState._(SessionStatus.transitioning));
    final operation = _tail.then((_) async {
      try {
        await _current?._close();
        _current = null;
        if (_disposed || generation != _generation) return;
        if (identity == null) {
          _publish(const SessionState._(SessionStatus.signedOut));
          return;
        }
        final handle = SessionHandle._(
          SessionKey._(identity, generation, _owner),
        );
        _current = handle;
        await prepare?.call(handle);
        if (_disposed || generation != _generation) return;
        handle.requireActive();
        _publish(SessionState._(SessionStatus.ready, session: handle));
        diagnostics.record(
          const DiagnosticEvent(
            operation: DiagnosticOperation.sessionTransition,
            outcome: DiagnosticOutcome.succeeded,
          ),
        );
      } catch (error) {
        _current?._revoke();
        final failure = error is AppFailure
            ? error
            : AppFailure(FailureKind.unexpected, cause: error);
        if (!_disposed && generation == _generation) {
          _publish(SessionState._(SessionStatus.failed, failure: failure));
          diagnostics.record(
            DiagnosticEvent(
              operation: DiagnosticOperation.sessionTransition,
              outcome: DiagnosticOutcome.failed,
              failure: failure.kind,
            ),
          );
        }
        throw failure;
      }
    });
    _tail = operation.then<void>((_) {}, onError: (Object _, StackTrace _) {});
    return operation;
  }

  void _publish(SessionState state) {
    _state = state;
    _events.add(state);
  }

  /// Revokes immediately; callers await cleanup before tearing down storage.
  Future<void> dispose() {
    if (_disposing != null) return _disposing!;
    _disposed = true;
    ++_generation;
    _current?._revoke();
    _publish(const SessionState._(SessionStatus.closed));
    return _disposing = _finishDisposal();
  }

  Future<void> _finishDisposal() async {
    await _tail;
    try {
      await _current?._close();
      _current = null;
    } finally {
      await _events.close();
    }
  }
}
