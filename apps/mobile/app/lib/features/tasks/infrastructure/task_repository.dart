import 'dart:async';

import 'package:core/core.dart';

import '../domain/task.dart';
import 'task_api.dart';

final class _Completion {
  _Completion(this.id, this.note, this.etag);
  final String id;
  final String note;
  final String etag;
}

/// The example's feature policy. It intentionally lives outside core and ui.
final class SessionTaskRepository implements TaskRepository {
  SessionTaskRepository({
    required this.session,
    required this.api,
    required this.newOperationId,
    this.diagnostics = const Diagnostics(),
  }) {
    session.registerCleanup(close);
  }

  final SessionHandle session;
  final TaskApi api;
  final String Function() newOperationId;
  final Diagnostics diagnostics;
  final _events = StreamController<void>.broadcast();
  final Map<String, Task> _confirmed = {};
  final Map<String, _Completion> _operations = {};
  final Map<String, Future<void>> _inFlight = {};
  final Map<String, FailureKind> _failures = {};
  final Map<String, int> _readGenerations = {};
  final Set<String> _loading = {};
  List<String> _ids = [];
  bool _listLoaded = false;
  bool _listLoading = false;
  FailureKind? _listFailure;
  int _listGeneration = 0;
  int _mutationGeneration = 0;
  bool _closed = false;
  Future<void>? _closing;
  int _subscribers = 0;

  int get subscriberCount => _subscribers;
  bool get isClosed => _closed;
  bool get _active => !_closed && session.isActive;

  void _checkActive() {
    session.requireActive();
    if (_closed) throw const AppFailure(FailureKind.sessionExpired);
  }

  void _emit() {
    if (_active) _events.add(null);
  }

  TaskResource _resource(String id) {
    final confirmed = _confirmed[id];
    final pending = _inFlight.containsKey(id);
    final operation = _operations[id];
    return TaskResource(
      sessionKey: session.key,
      task: pending && operation != null
          ? confirmed?.complete(operation.note)
          : confirmed,
      loading: _loading.contains(id),
      pending: pending,
      needsRetry: operation != null && !pending,
      failure: _failures[id],
    );
  }

  TaskListResource _list() => TaskListResource(
    sessionKey: session.key,
    tasks: _ids.map(_resource).toList(),
    loading: _listLoading,
    failure: _listFailure,
  );

  Stream<T> _watch<T>(T Function() snapshot, void Function() ensureLoaded) =>
      Stream.multi((controller) {
        if (!_active) {
          controller.closeSync();
          return;
        }
        _subscribers++;
        final subscription = _events.stream.listen((_) {
          if (_active) controller.addSync(snapshot());
        }, onDone: controller.closeSync);
        controller.onCancel = () async {
          _subscribers--;
          await subscription.cancel();
        };
        ensureLoaded();
        controller.addSync(snapshot());
      });

  @override
  Stream<TaskListResource> watchList() => _watch(_list, () {
    if (!_listLoaded && !_listLoading) unawaited(refreshList());
  });

  @override
  Stream<TaskResource> watch(String id) => _watch(() => _resource(id), () {
    if (!_confirmed.containsKey(id) && !_loading.contains(id)) {
      unawaited(refresh(id));
    }
  });

  void _merge(Task task) {
    final current = _confirmed[task.id];
    if (current == null || task.revision > current.revision) {
      _confirmed[task.id] = task;
    }
  }

  @override
  Future<void> refreshList() async {
    _checkActive();
    final generation = ++_listGeneration;
    final mutation = _mutationGeneration;
    _listLoading = true;
    _listFailure = null;
    _emit();
    try {
      final tasks = await api.list();
      if (!_active || generation != _listGeneration) return;
      for (final task in tasks) {
        _merge(task);
      }
      if (mutation == _mutationGeneration) {
        _ids = tasks.map((task) => task.id).toSet().toList();
        _listLoaded = true;
      }
    } catch (error) {
      if (_active && generation == _listGeneration) {
        _listFailure = _kind(error);
      }
    } finally {
      if (_active && generation == _listGeneration) {
        _listLoading = false;
        _emit();
      }
    }
  }

  @override
  Future<void> refresh(String id) async {
    _checkActive();
    final generation = (_readGenerations[id] ?? 0) + 1;
    _readGenerations[id] = generation;
    _loading.add(id);
    _failures.remove(id);
    _emit();
    try {
      final task = await api.read(id);
      if (!_active || generation != _readGenerations[id]) return;
      _merge(task);
    } catch (error) {
      if (_active && generation == _readGenerations[id]) {
        _failures[id] = _kind(error);
      }
    } finally {
      if (_active && generation == _readGenerations[id]) {
        _loading.remove(id);
        _emit();
      }
    }
  }

  @override
  Future<void> complete(String id, String note) {
    _checkActive();
    if (_inFlight[id] case final existing?) return existing;
    if (_operations.containsKey(id)) {
      throw const AppFailure(FailureKind.conflict);
    }
    final task = _confirmed[id];
    if (task == null || task.completed || note.trim().isEmpty) {
      throw const AppFailure(FailureKind.validation);
    }
    _operations[id] = _Completion(newOperationId(), note, task.versionToken);
    return _send(id);
  }

  @override
  Future<void> retryCompletion(String id) {
    _checkActive();
    if (_inFlight[id] case final existing?) return existing;
    if (!_operations.containsKey(id)) {
      throw const AppFailure(FailureKind.validation);
    }
    return _send(id);
  }

  Future<void> _send(String id) {
    final operation = _operations[id]!;
    final completer = Completer<void>();
    _inFlight[id] = completer.future;
    ++_mutationGeneration;
    _failures.remove(id);
    _emit();
    unawaited(_settle(id, operation, completer));
    return completer.future;
  }

  Future<void> _settle(
    String id,
    _Completion operation,
    Completer<void> completer,
  ) async {
    try {
      final task = await api.complete(
        id,
        note: operation.note,
        etag: operation.etag,
        operationId: operation.id,
      );
      _checkActive();
      _merge(task);
      _operations.remove(id);
      diagnostics.record(
        const DiagnosticEvent(
          operation: DiagnosticOperation.submit,
          outcome: DiagnosticOutcome.succeeded,
        ),
      );
      completer.complete();
    } catch (error, stack) {
      final kind = _active ? _kind(error) : FailureKind.sessionExpired;
      if (_active) {
        _failures[id] = kind;
        if (kind != FailureKind.unavailable && kind != FailureKind.unexpected) {
          _operations.remove(id);
        }
        diagnostics.record(
          DiagnosticEvent(
            operation: DiagnosticOperation.submit,
            outcome: DiagnosticOutcome.failed,
            failure: kind,
          ),
        );
      }
      completer.completeError(AppFailure(kind), stack);
    } finally {
      // The caller observes this future; awaiting it here would await ourselves.
      // ignore: unawaited_futures
      _inFlight.remove(id);
      ++_mutationGeneration;
      _emit();
    }
  }

  FailureKind _kind(Object error) =>
      error is AppFailure ? error.kind : FailureKind.unexpected;

  Future<void> close() {
    if (_closing != null) return _closing!;
    _closed = true;
    _confirmed.clear();
    _operations.clear();
    _failures.clear();
    _ids = [];
    return _closing = _events.close();
  }
}
