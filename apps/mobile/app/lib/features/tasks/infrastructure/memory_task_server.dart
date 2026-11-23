import 'package:core/core.dart';

import '../domain/task.dart';
import 'task_api.dart';

enum CompletionBehavior { succeed, reject, loseResponse }

/// Synthetic server state survives account replacement, like a remote service.
final class MemoryTaskServer {
  MemoryTaskServer({this.latency = const Duration(milliseconds: 300)});

  final Duration latency;
  final Map<SessionIdentity, Map<String, Task>> _accounts = {};
  final Map<(SessionIdentity, String), (String, String, String, Task)>
  _results = {};
  final Map<SessionIdentity, CompletionBehavior> _nextCompletion = {};

  void simulateNextCompletion(
    SessionIdentity identity,
    CompletionBehavior behavior,
  ) {
    _nextCompletion[identity] = behavior;
  }

  int completionRequests = 0;

  TaskApi forAccount(SessionIdentity identity) => _AccountApi(this, identity);

  Map<String, Task> _tasks(SessionIdentity identity) => _accounts.putIfAbsent(
    identity,
    () => {
      '1': Task(
        id: '1',
        title: '${identity.accountId}: Plan the first release',
        revision: 7,
        versionToken: '"task-1-7"',
      ),
      '2': Task(
        id: '2',
        title: '${identity.accountId}: Review the checklist',
        revision: 1,
        versionToken: '"task-2-1"',
      ),
    },
  );
}

final class _AccountApi implements TaskApi {
  _AccountApi(this.server, this.identity);
  final MemoryTaskServer server;
  final SessionIdentity identity;

  @override
  Future<List<Task>> list() async {
    final snapshot = server._tasks(identity).values.toList();
    await Future<void>.delayed(server.latency);
    return snapshot;
  }

  @override
  Future<Task> read(String id) async {
    final task = server._tasks(identity)[id];
    await Future<void>.delayed(server.latency);
    if (task == null) throw const AppFailure(FailureKind.validation);
    return task;
  }

  @override
  Future<Task> complete(
    String id, {
    required String note,
    required String etag,
    required String operationId,
  }) async {
    server.completionRequests++;
    final behavior =
        server._nextCompletion.remove(identity) ?? CompletionBehavior.succeed;
    await Future<void>.delayed(server.latency);
    final key = (identity, operationId);
    final previous = server._results[key];
    if (previous != null) {
      if (previous.$1 != id || previous.$2 != note || previous.$3 != etag) {
        throw const AppFailure(FailureKind.validation);
      }
      return previous.$4;
    }
    if (behavior == CompletionBehavior.reject) {
      throw const AppFailure(FailureKind.validation);
    }
    final task = server._tasks(identity)[id];
    if (task == null) throw const AppFailure(FailureKind.validation);
    if (task.versionToken != etag) throw const AppFailure(FailureKind.conflict);
    if (task.completed || note.trim().isEmpty) {
      throw const AppFailure(FailureKind.validation);
    }
    final result = task.complete(
      note,
      revision: task.revision + 1,
      versionToken: '"task-$id-${task.revision + 1}"',
    );
    server._tasks(identity)[id] = result;
    server._results[key] = (id, note, etag, result);
    if (behavior == CompletionBehavior.loseResponse) {
      throw const AppFailure(FailureKind.unavailable);
    }
    return result;
  }
}
