import 'dart:io';

import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';

import 'file_store.dart';

const _backupChannel = MethodChannel('id.replo.mobile/backup_exclusion');

Future<void> _excludeFromBackup(String path) async {
  if (!Platform.isIOS && !Platform.isMacOS) return;
  try {
    await _backupChannel.invokeMethod<void>('excludeFromBackup', path);
  } on MissingPluginException {
    // Unit tests run without platform runner channels.
  } on PlatformException {
    // The file is already encrypted under a device-only keystore key.
  }
}

/// The app's support directory. A write replaces the file in one step, so
/// a crash leaves either the old file or the new one, never half of each.
final class DirectoryFileStore implements FileStore {
  DirectoryFileStore([Future<Directory> Function()? directory])
    : _directory = directory ?? getApplicationSupportDirectory;
  final Future<Directory> Function() _directory;

  Future<File> _file(String name) async {
    final directory = await _directory();
    await directory.create(recursive: true);
    return File('${directory.path}/$name');
  }

  @override
  Future<Uint8List?> read(String name) async {
    final file = await _file(name);
    return await file.exists() ? file.readAsBytes() : null;
  }

  @override
  Future<void> write(String name, List<int> bytes) async {
    final file = await _file(name);
    final staging = File('${file.path}.new');
    await staging.writeAsBytes(bytes, flush: true);
    await staging.rename(file.path);
    await _excludeFromBackup(file.path);
  }

  @override
  Future<void> delete(String name) async {
    final file = await _file(name);
    if (await file.exists()) await file.delete();
  }
}

FileStore createPlatformFileStore() => DirectoryFileStore();
