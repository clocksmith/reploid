/// What this device keeps between runs: small secrets in the platform
/// keystore, and files in the app's private directory.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

/// Named secrets. On a device this is the platform keystore.
abstract interface class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Lost when the process ends. For tests and builds without a keystore.
final class MemorySecretStore implements SecretStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// Keychain on iOS and macOS, Keystore on Android. Not yet exercised on a
/// physical device.
final class SecureSecretStore implements SecretStore {
  const SecureSecretStore([this._storage = const FlutterSecureStorage()]);
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

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
  }

  @override
  Future<void> delete(String name) async {
    final file = await _file(name);
    if (await file.exists()) await file.delete();
  }
}
