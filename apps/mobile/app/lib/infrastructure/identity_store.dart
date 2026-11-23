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
