import 'dart:typed_data';

/// Named files private to the app. Callers encrypt what they write.
abstract interface class FileStore {
  Future<Uint8List?> read(String name);
  Future<void> write(String name, List<int> bytes);
  Future<void> delete(String name);
}

final class MemoryFileStore implements FileStore {
  final Map<String, Uint8List> files = {};

  @override
  Future<Uint8List?> read(String name) async => files[name];

  @override
  Future<void> write(String name, List<int> bytes) async =>
      files[name] = Uint8List.fromList(bytes);

  @override
  Future<void> delete(String name) async => files.remove(name);
}
