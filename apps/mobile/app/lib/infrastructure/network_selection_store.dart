import 'dart:convert';

import '../features/chat/domain/chat.dart';
import 'device_stores.dart';

/// Persists the user's chosen network mode and private room credentials in
/// the platform keystore.
final class NetworkPreferenceStore {
  const NetworkPreferenceStore(this._secrets);
  final SecretStore _secrets;
  static const _key = 'reploid.network-preference.v1';

  Future<NetworkPreference?> read() async {
    final raw = await _secrets.read(_key);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;
      final mode = NetworkMode.values
          .where((m) => m.name == decoded['mode'])
          .firstOrNull;
      if (mode == null) return null;
      final pref = NetworkPreference(
        mode: mode,
        signalingUrl: decoded['signalingUrl'] is String
            ? decoded['signalingUrl']! as String
            : '',
        roomId: decoded['roomId'] is String ? decoded['roomId']! as String : '',
        token: decoded['token'] is String ? decoded['token']! as String : '',
        origin: decoded['origin'] is String ? decoded['origin']! as String : '',
        rtcConfigUrl: decoded['rtcConfigUrl'] is String
            ? decoded['rtcConfigUrl']! as String
            : '',
      );
      return pref.isValid ? pref : null;
    } on FormatException {
      return null;
    }
  }

  Future<void> write(NetworkPreference preference) => _secrets.write(
    _key,
    jsonEncode({
      'mode': preference.mode.name,
      'signalingUrl': preference.signalingUrl,
      'roomId': preference.roomId,
      'token': preference.token,
      'origin': preference.origin,
      'rtcConfigUrl': preference.rtcConfigUrl,
    }),
  );

  Future<void> delete() => _secrets.delete(_key);
}
