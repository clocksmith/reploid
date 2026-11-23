import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/tasks/domain/task.dart';
import 'package:reploid_mobile/features/tasks/infrastructure/memory_task_server.dart';
import 'package:reploid_mobile/features/tasks/infrastructure/task_api.dart';
import 'package:reploid_mobile/features/tasks/infrastructure/task_repository.dart';

class ControlledApi implements TaskApi {
  final listResponse = Completer<List<Task>>();
  final writeResponse = Completer<Task>();
  int writes = 0;
  @override
  Future<List<Task>> list() => listResponse.future;
  @override
  Future<Task> read(String id) async => Task(
    id: id,
    title: 'Task',
    revision: 7,
    versionToken: 'opaque-token-from-server',
  );
  @override
  Future<Task> complete(
    String id, {
    required String note,
    required String etag,
    required String operationId,
  }) {
    expect(etag, 'opaque-token-from-server');
    writes++;
    return writeResponse.future;
  }
}

void main() {
  late SessionCoordinator coordinator;
  var operation = 0;
  setUp(() async {
    coordinator = SessionCoordinator();
    await coordinator.activate(const SessionIdentity('A'));
  });
  tearDown(() => coordinator.dispose());

  SessionTaskRepository repository(TaskApi api) => SessionTaskRepository(
    session: coordinator.state.session!,
    api: api,
    newOperationId: () => 'operation-${operation++}',
  );

  test(
    'late list cannot regress a write; duplicate taps share an operation',
    () async {
      final api = ControlledApi();
      final repo = repository(api);
      await repo.refresh('1');
      final refresh = repo.refreshList();
      final first = repo.complete('1', 'Original note');
      final second = repo.complete('1', 'A duplicate note');
      expect(identical(first, second), isTrue);
      expect(api.writes, 1);
      api.writeResponse.complete(
        const Task(
          id: '1',
          title: 'Task',
          revision: 8,
          versionToken: 'new-token',
          completed: true,
          note: 'Original note',
        ),
      );
      await first;
      api.listResponse.complete([
        const Task(
          id: '1',
          title: 'Task',
          revision: 7,
          versionToken: 'opaque-token-from-server',
        ),
      ]);
      await refresh;
      final detail = await repo.watch('1').first;
      expect(detail.task!.revision, 8);
      expect(detail.task!.completed, isTrue);
      expect(detail.task!.note, 'Original note');
    },
  );

  test(
    'list and detail share optimistic state and roll back rejection',
    () async {
      final server = MemoryTaskServer(latency: const Duration(milliseconds: 5));
      final repo = repository(server.forAccount(const SessionIdentity('A')));
      await repo.refreshList();
      final lists = <TaskListResource>[];
      final details = <TaskResource>[];
      final listSub = repo.watchList().listen(lists.add);
      final detailSub = repo.watch('1').listen(details.add);
      addTearDown(listSub.cancel);
      addTearDown(detailSub.cancel);
      server.simulateNextCompletion(
        const SessionIdentity('A'),
        CompletionBehavior.reject,
      );
      await expectLater(
        repo.complete('1', 'Draft'),
        throwsA(isA<AppFailure>()),
      );
      await Future<void>.delayed(Duration.zero);
      expect(
        lists.any(
          (list) =>
              list.tasks.first.pending && list.tasks.first.task!.completed,
        ),
        isTrue,
      );
      expect(
        details.any((detail) => detail.pending && detail.task!.completed),
        isTrue,
      );
      expect(details.last.task!.completed, isFalse);
      expect(lists.last.tasks.first.task!.completed, isFalse);
      expect(details.last.needsRetry, isFalse);
    },
  );

  test(
    'lost response retries original key, payload, and precondition',
    () async {
      final server = MemoryTaskServer(latency: Duration.zero);
      final repo = repository(server.forAccount(const SessionIdentity('A')));
      await repo.refresh('1');
      server.simulateNextCompletion(
        const SessionIdentity('A'),
        CompletionBehavior.loseResponse,
      );
      await expectLater(
        repo.complete('1', 'Original'),
        throwsA(isA<AppFailure>()),
      );
      expect((await repo.watch('1').first).needsRetry, isTrue);
      await repo.retryCompletion('1');
      final settled = await repo.watch('1').first;
      expect(settled.task!.note, 'Original');
      expect(settled.task!.revision, 8);
      expect(settled.needsRetry, isFalse);
      expect(server.completionRequests, 2);
    },
  );

  test('account switch closes streams and rejects a late write', () async {
    final api = ControlledApi();
    final repo = repository(api);
    await repo.refresh('1');
    final values = <TaskResource>[];
    final sub = repo.watch('1').listen(values.add);
    await Future<void>.delayed(Duration.zero);
    expect(repo.subscriberCount, 1);
    final writing = repo.complete('1', 'Private note');
    final expectation = expectLater(
      writing,
      throwsA(
        isA<AppFailure>().having(
          (e) => e.kind,
          'kind',
          FailureKind.sessionExpired,
        ),
      ),
    );
    await coordinator.activate(const SessionIdentity('B'));
    expect(repo.isClosed, isTrue);
    expect(repo.subscriberCount, 0);
    final count = values.length;
    api.writeResponse.complete(
      const Task(
        id: '1',
        title: 'A',
        revision: 8,
        versionToken: 'new-token',
        completed: true,
      ),
    );
    await expectation;
    await Future<void>.delayed(Duration.zero);
    expect(values.length, count);
    await sub.cancel();
  });

  test(
    'subscription cancellation and resubscription preserve authority',
    () async {
      final repo = repository(
        MemoryTaskServer(latency: Duration.zero)
            .forAccount(const SessionIdentity('A')),
      );
      await repo.refresh('1');
      final subscription = repo.watch('1').listen((_) {});
      await Future<void>.delayed(Duration.zero);
      expect(repo.subscriberCount, 1);
      await subscription.cancel();
      expect(repo.subscriberCount, 0);
      await repo.complete('1', 'Done');
      expect((await repo.watch('1').first).task!.revision, 8);
    },
  );
  test('failure injection and idempotency are isolated by account', () async {
    final server = MemoryTaskServer(latency: Duration.zero);
    const a = SessionIdentity('A');
    const b = SessionIdentity('B');
    server.simulateNextCompletion(a, CompletionBehavior.reject);
    final apiB = server.forAccount(b);
    final beforeB = await apiB.read('1');
    final completedB = await apiB.complete(
      '1',
      note: 'B only',
      etag: beforeB.versionToken,
      operationId: 'same-operation',
    );
    expect(completedB.note, 'B only');
    final apiA = server.forAccount(a);
    final beforeA = await apiA.read('1');
    await expectLater(
      apiA.complete(
        '1',
        note: 'A only',
        etag: beforeA.versionToken,
        operationId: 'same-operation',
      ),
      throwsA(
        isA<AppFailure>().having(
          (error) => error.kind,
          'kind',
          FailureKind.validation,
        ),
      ),
    );
    expect((await apiA.read('1')).completed, isFalse);
    final completedA = await apiA.complete(
      '1',
      note: 'A only',
      etag: beforeA.versionToken,
      operationId: 'same-operation',
    );
    expect(completedA.note, 'A only');
    expect((await apiB.read('1')).note, 'B only');
  });
}
