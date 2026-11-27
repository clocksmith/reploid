import 'dart:convert';

import '../../../infrastructure/device_stores.dart';
import 'local_data.dart';

/// Names and blocks this device keeps for computers, per signing identity.
/// They change only where this device sends its own requests.
final class ComputerPreferences {
  const ComputerPreferences({this.names = const {}, this.blocked = const []});
  final Map<String, String> names;
  final List<String> blocked;
}

final class ComputerPreferencesStore {
  ComputerPreferencesStore(this._secrets, String participantId)
    : _key =
          'reploid.computer-preferences.v1.'
          '${participantId.replaceAll(RegExp('[^a-z0-9]'), '')}';

  final SecretStore _secrets;
  final String _key;

  /// Throws when a stored value cannot be read. A block list that cannot
  /// be read must not quietly become an empty one.
  Future<ComputerPreferences> read() async {
    final raw = await _secrets.read(_key);
    if (raw == null) return const ComputerPreferences();
    final decoded = jsonDecode(raw);
    if (decoded is! Map ||
        decoded['names'] is! Map ||
        decoded['blocked'] is! List) {
      throw const FormatException('Unreadable computer preferences');
    }
    final names = <String, String>{};
    for (final MapEntry(:key, :value) in (decoded['names'] as Map).entries) {
      if (key is! String ||
          value is! String ||
          !validComputerName(key, value)) {
        throw const FormatException('Unreadable computer name');
      }
      names[key] = value;
    }
    final blocked = <String>[];
    for (final id in decoded['blocked'] as List) {
      if (id is! String || !validComputerId(id)) {
        throw const FormatException('Unreadable blocked computer');
      }
      blocked.add(id);
    }
    return ComputerPreferences(names: names, blocked: blocked);
  }

  Future<void> write(ComputerPreferences preferences) => _secrets.write(
    _key,
    jsonEncode({'names': preferences.names, 'blocked': preferences.blocked}),
  );

  Future<void> delete() => _secrets.delete(_key);
}
