import 'package:core/core.dart';

final class Task {
  const Task({
    required this.id,
    required this.title,
    required this.revision,
    required this.versionToken,
    this.completed = false,
    this.note = '',
  });

  final String id;
  final String title;
  final int revision;
  final String versionToken;
  final bool completed;
  final String note;

  Task complete(String note, {int? revision, String? versionToken}) => Task(
    id: id,
    title: title,
    revision: revision ?? this.revision,
    versionToken: versionToken ?? this.versionToken,
    completed: true,
    note: note,
  );
}

final class TaskResource {
  const TaskResource({
    required this.sessionKey,
    this.task,
    this.loading = false,
    this.pending = false,
    this.needsRetry = false,
    this.failure,
  });

  final SessionKey sessionKey;
  final Task? task;
  final bool loading;
  final bool pending;
  final bool needsRetry;
  final FailureKind? failure;
}

final class TaskListResource {
  TaskListResource({
    required this.sessionKey,
    required List<TaskResource> tasks,
    this.loading = false,
    this.failure,
  }) : tasks = List.unmodifiable(tasks);

  final SessionKey sessionKey;
  final List<TaskResource> tasks;
  final bool loading;
  final FailureKind? failure;
}

abstract interface class TaskRepository {
  Stream<TaskListResource> watchList();
  Stream<TaskResource> watch(String id);
  Future<void> refreshList();
  Future<void> refresh(String id);
  Future<void> complete(String id, String note);
  Future<void> retryCompletion(String id);
}
