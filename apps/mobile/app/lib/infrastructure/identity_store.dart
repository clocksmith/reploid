import 'dart:convert';

import 'device_stores.dart';
import 'reploid_api/identity.dart';

/// Where this device keeps its signing identity bundle, as one JSON string.
final class IdentityStore {
  const IdentityStore(this._secrets);
  final SecretStore _secrets;
  static const _key = 'reploid.identity.v1';

  Future<String?> read() => _secrets.read(_key);
  Future<void> write(String bundle) => _secrets.write(_key, bundle);
  Future<void> delete() => _secrets.delete(_key);
}

/// Loads the stored identity, or creates one only when none is stored.
///
/// Fails closed if a stored bundle exists but cannot be parsed or verified:
/// silently minting a replacement identity would orphan encrypted history
/// and desktop pairings tied to the original participant ID.
Future<SigningIdentity> loadOrCreateIdentity(IdentityStore store) async {
  final stored = await store.read();
  if (stored != null) {
    final Object? decoded;
    try {
      decoded = jsonDecode(stored);
    } on FormatException {
      throw const FormatException('Stored signing identity is unreadable');
    }
    if (decoded is! Map<String, Object?>) {
      throw const FormatException('Stored signing identity is not an object');
    }
    return SigningIdentity.fromBundle(decoded);
  }
  final identity = await SigningIdentity.generate();
  await store.write(jsonEncode(identity.toBundle()));
  return identity;
}
