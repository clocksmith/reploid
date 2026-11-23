import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'reploid_api/identity.dart';

/// Where this device keeps its signing identity bundle, as one JSON string.
abstract interface class IdentityStore {
  Future<String?> read();
  Future<void> write(String bundle);
  Future<void> delete();
}

/// Lost when the process ends. For tests and builds without device storage.
final class MemoryIdentityStore implements IdentityStore {
  String? _bundle;

  @override
  Future<String?> read() async => _bundle;

  @override
  Future<void> write(String bundle) async => _bundle = bundle;

  @override
  Future<void> delete() async => _bundle = null;
}

/// The platform keystore: Keychain on iOS and macOS, Keystore on Android.
/// Not yet exercised on a physical device.
final class SecureIdentityStore implements IdentityStore {
  const SecureIdentityStore([this._storage = const FlutterSecureStorage()]);
  final FlutterSecureStorage _storage;
  static const _key = 'reploid.identity.v1';

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String bundle) => _storage.write(key: _key, value: bundle);

  @override
  Future<void> delete() => _storage.delete(key: _key);
}

/// The stored identity, or a new one when none is stored or the stored one
/// does not hold together. A replaced identity is a new participant.
Future<SigningIdentity> loadOrCreateIdentity(IdentityStore store) async {
  final stored = await store.read();
  if (stored != null) {
    try {
      final decoded = jsonDecode(stored);
      if (decoded is Map<String, Object?>) {
        return await SigningIdentity.fromBundle(decoded);
      }
    } on FormatException {
      // Fall through and replace the unusable bundle.
    }
  }
  final identity = await SigningIdentity.generate();
  await store.write(jsonEncode(identity.toBundle()));
  return identity;
}
