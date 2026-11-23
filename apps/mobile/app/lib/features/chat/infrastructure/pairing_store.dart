import 'dart:convert';

import '../../../infrastructure/device_stores.dart';
import '../../../infrastructure/reploid_api/contract.g.dart';
import '../../../infrastructure/reploid_api/pairing.dart';

/// The paired desktop of one device identity, in the platform keystore.
/// It holds the desktop's signing identity, label and room; never a code.
final class PairingStore {
  PairingStore(this._secrets, String participantId)
    : _key =
          '${Contract.pairingStorageKey}.'
          '${participantId.replaceAll(RegExp('[^a-z0-9]'), '')}';
  final SecretStore _secrets;
  final String _key;

  Future<PairingRecord?> read() async {
    final stored = await _secrets.read(_key);
    if (stored == null) return null;
    try {
      return PairingRecord.fromJson(jsonDecode(stored));
    } on FormatException {
      return null;
    }
  }

  Future<void> write(PairingRecord record) =>
      _secrets.write(_key, jsonEncode(record.toJson()));

  Future<void> delete() => _secrets.delete(_key);
}
