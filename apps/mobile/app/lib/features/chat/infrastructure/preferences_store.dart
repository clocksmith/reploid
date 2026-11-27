import '../../../infrastructure/device_stores.dart';

/// Per-identity device preferences kept in the platform keystore.
final class DevicePreferencesStore {
  DevicePreferencesStore(this._secrets, String participantId)
    : _allowedKey =
          'reploid.network-answers-allowed.v1.'
          '${participantId.replaceAll(RegExp('[^a-z0-9]'), '')}';

  final SecretStore _secrets;
  final String _allowedKey;

  /// Defaults to true when not yet set. Unrecognized values fail closed to false.
  Future<bool> readNetworkAnswersAllowed() async {
    final stored = await _secrets.read(_allowedKey);
    if (stored == null) return true;
    return stored == 'true';
  }

  Future<void> writeNetworkAnswersAllowed(bool allowed) =>
      _secrets.write(_allowedKey, allowed ? 'true' : 'false');

  Future<void> delete() => _secrets.delete(_allowedKey);
}
