import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/task.dart';

final taskRepositoryProvider = Provider<TaskRepository?>(
  (ref) => throw StateError('Composition must supply the session repository'),
);

final taskListProvider = StreamProvider.autoDispose<TaskListResource>(
  (ref) =>
      ref.watch(taskRepositoryProvider)?.watchList() ?? const Stream.empty(),
);

final taskProvider = StreamProvider.autoDispose.family<TaskResource, String>(
  (ref, id) =>
      ref.watch(taskRepositoryProvider)?.watch(id) ?? const Stream.empty(),
);
