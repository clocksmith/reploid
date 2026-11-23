import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:core/core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/tasks/domain/task.dart';
import '../features/tasks/infrastructure/memory_task_server.dart';
import '../features/tasks/infrastructure/task_api.dart';
import '../features/tasks/infrastructure/task_repository.dart';

export '../features/tasks/presentation/task_providers.dart';

final sessionCoordinatorProvider = Provider<SessionCoordinator>(
  (ref) => throw StateError('Bootstrap must supply SessionCoordinator'),
);

final memoryServerProvider = Provider<MemoryTaskServer>(
  (ref) => MemoryTaskServer(),
);

final taskApiFactoryProvider = Provider<TaskApi Function(SessionIdentity)>(
  (ref) => ref.watch(memoryServerProvider).forAccount,
);

final operationIdProvider = Provider<String Function()>((ref) {
  final random = Random.secure();
  return () => base64UrlEncode(List.generate(24, (_) => random.nextInt(256)));
});

final sessionStateProvider = NotifierProvider<SessionController, SessionState>(
  SessionController.new,
);

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() {
    final coordinator = ref.watch(sessionCoordinatorProvider);
    final subscription = coordinator.watch().listen((next) {
      if (ref.mounted) state = next;
    });
    ref.onDispose(() => unawaited(subscription.cancel()));
    return coordinator.state;
  }

  Future<void> activate(String account) async {
    try {
      await ref
          .read(sessionCoordinatorProvider)
          .activate(SessionIdentity(account));
    } on AppFailure {
      // The coordinator exposes a safe failure state through the subscription.
    }
  }

  Future<void> signOut() async {
    try {
      await ref.read(sessionCoordinatorProvider).signOut();
    } on AppFailure {
      // The session gate renders cleanup failures without old account content.
    }
  }
}

/// Called by the composition override; the implementation remains private to it.
TaskRepository? createTaskRepository(Ref ref) {
  final session = ref.watch(sessionStateProvider).session;
  if (session == null || !session.isActive) return null;
  final repository = SessionTaskRepository(
    session: session,
    api: ref.watch(taskApiFactoryProvider)(session.key.identity),
    newOperationId: ref.watch(operationIdProvider),
  );
  ref.onDispose(() => unawaited(repository.close()));
  return repository;
}
