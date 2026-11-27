import 'dart:typed_data';

import 'file_store.dart';

/// Web builds do not have a dart:io filesystem; conversations remain in memory
/// for the browser session unless another [FileStore] is supplied.
final class DirectoryFileStore implements FileStore {
  final MemoryFileStore _memory = MemoryFileStore();

  @override
  Future<Uint8List?> read(String name) => _memory.read(name);

  @override
  Future<void> write(String name, List<int> bytes) =>
      _memory.write(name, bytes);

  @override
  Future<void> delete(String name) => _memory.delete(name);
}

FileStore createPlatformFileStore() => MemoryFileStore();
