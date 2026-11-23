/// What this device keeps between runs: small secrets in the platform
/// keystore, and files in the app's private directory.
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'device_stores_web.dart'
    if (dart.library.io) 'device_stores_io.dart'
    as platform;
import 'file_store.dart';

export 'device_stores_web.dart'
    if (dart.library.io) 'device_stores_io.dart'
    show DirectoryFileStore;
export 'file_store.dart';

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

/// Keychain on iOS and macOS, Keystore on Android.
///
/// Device-only accessibility (`first_unlock_this_device`) keeps keys out of
/// cloud backups and migrations. On macOS, `usesDataProtectionKeychain: false`
/// uses the login Keychain so ad-hoc signed local builds do not fail with
/// Keychain error -34018.
final class SecureSecretStore implements SecretStore {
  const SecureSecretStore([
    this._storage = const FlutterSecureStorage(
      iOptions: IOSOptions(
        accountName: 'id.replo.mobile',
        accessibility: KeychainAccessibility.first_unlock_this_device,
        synchronizable: false,
      ),
      mOptions: MacOsOptions(
        accountName: 'id.replo.mobile',
        accessibility: KeychainAccessibility.first_unlock_this_device,
        synchronizable: false,
        usesDataProtectionKeychain: false,
      ),
    ),
  ]);
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) =>
      _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// Returns [DirectoryFileStore] on IO platforms and an in-memory store on web.
FileStore createDefaultFileStore() => platform.createPlatformFileStore();
