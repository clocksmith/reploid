import 'package:core/core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/app/providers.dart';
import 'package:reploid_mobile/features/tasks/infrastructure/memory_task_server.dart';
import 'package:reploid_mobile/features/tasks/infrastructure/task_repository.dart';

void main() {
  test(
    'provider dependencies replace repositories even for the same account',
    () async {
      final coordinator = SessionCoordinator();
      final container = ProviderContainer.test(
        overrides: [
          sessionCoordinatorProvider.overrideWithValue(coordinator),
          taskRepositoryProvider.overrideWith(createTaskRepository),
          memoryServerProvider.overrideWithValue(
            MemoryTaskServer(latency: Duration.zero),
          ),
        ],
      );
      addTearDown(coordinator.dispose);
      container.listen(taskRepositoryProvider, (_, _) {});
      await coordinator.activate(const SessionIdentity('A'));
      await container.pump();
      final first =
          container.read(taskRepositoryProvider)! as SessionTaskRepository;
      final reader = container.listen(taskProvider('1'), (_, _) {});
      await container.read(taskProvider('1').future);
      expect(first.subscriberCount, 1);
      reader.close();
      await container.pump();
      expect(first.subscriberCount, 0);
      expect(first.isClosed, isFalse);
      await coordinator.signOut();
      await coordinator.activate(const SessionIdentity('A'));
      await container.pump();
      final second =
          container.read(taskRepositoryProvider)! as SessionTaskRepository;
      expect(identical(first, second), isFalse);
      expect(first.isClosed, isTrue);
      expect(first.session.key, isNot(second.session.key));
    },
  );
}
