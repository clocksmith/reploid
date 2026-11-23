import '../domain/task.dart';

/// Account binding is supplied when the adapter is created.
abstract interface class TaskApi {
  Future<List<Task>> list();
  Future<Task> read(String id);
  Future<Task> complete(
    String id, {
    required String note,
    required String etag,
    required String operationId,
  });
}
