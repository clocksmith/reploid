/// Owner pairing, phone side: the pairing link, the room where a desktop
/// offers pairing, and the record that pins one desktop by its signing
/// identity (contract procedures `pairingLinkParse`, `pairingRoom`,
/// `pairedDesktopRecognition`).
library;

import 'dart:convert';

import 'contract.g.dart';

final _code = RegExp(Contract.pairingCodePattern);
final _participant = RegExp(Contract.pairingParticipantIdPattern);
final _room = RegExp(Contract.pairingRoomIdPattern, caseSensitive: false);

bool isPairingCode(String text) => _code.hasMatch(text);
bool isParticipantId(String text) => _participant.hasMatch(text);
bool isRoomId(String text) => _room.hasMatch(text);

/// What a pairing link carries. The code is single use and is never stored.
final class PairingLink {
  const PairingLink({
    required this.code,
    required this.hostParticipantId,
    this.hostLabel,
    this.roomId,
  });

  final String code;
  final String hostParticipantId;
  final String? hostLabel;
  final String? roomId;

  /// Procedure `pairingLinkParse`. Only the fragment is read, so the code
  /// never reaches a web server; any origin with a valid fragment parses.
  static PairingLink? parse(String text) {
    final uri = Uri.tryParse(text.trim());
    if (uri == null || !uri.hasScheme || !uri.hasFragment) return null;
    final values = <String, List<String>>{};
    for (final pair in uri.fragment.split('&')) {
      if (pair.isEmpty) continue;
      final cut = pair.indexOf('=');
      final String name, value;
      try {
        name = _decode(cut < 0 ? pair : pair.substring(0, cut));
        value = _decode(cut < 0 ? '' : pair.substring(cut + 1));
      } on FormatException {
        return null;
      } on ArgumentError {
        return null;
      }
      values.putIfAbsent(name, () => []).add(value);
    }
    String? one(String name, {bool required = false}) {
      final found = values[name] ?? const [];
      if (found.length > 1 || (required && found.isEmpty)) {
        throw const FormatException('parameter count');
      }
      return found.firstOrNull;
    }

    try {
      final code = one('pair', required: true)!;
      final host = one('host', required: true)!;
      final label = one('name')?.trim();
      final room = one('room')?.trim();
      if (!isPairingCode(code) || !isParticipantId(host)) return null;
      if (label != null &&
          (label.isEmpty || label.length > Contract.pairingLabelMaxLength)) {
        return null;
      }
      if (room != null && !isRoomId(room)) return null;
      return PairingLink(
        code: code,
        hostParticipantId: host,
        hostLabel: label,
        roomId: room,
      );
    } on FormatException {
      return null;
    }
  }

  static String _decode(String text) =>
      Uri.decodeQueryComponent(text, encoding: utf8);
}

/// Procedure `pairingRoom`: the marker both sides join a pairing room with.
/// It is not a secret and grants nothing.
String pairingRoomToken(String roomId) =>
    '${Contract.pairingRoomTokenPrefix}$roomId';

/// Everything the phone keeps about its desktop. It pins one thing: the
/// desktop's signing identity.
final class PairingRecord {
  const PairingRecord({
    required this.hostParticipantId,
    required this.hostLabel,
    required this.roomId,
    required this.pairedAt,
  });

  final String hostParticipantId;
  final String hostLabel;
  final String? roomId;
  final int? pairedAt;

  Map<String, Object?> toJson() => {
    'hostParticipantId': hostParticipantId,
    'hostLabel': hostLabel,
    'roomId': roomId,
    'pairedAt': pairedAt,
  };

  /// Reads a stored record as the web client does: the desktop's identity
  /// must be valid or there is no record; a missing label becomes that
  /// identity, an invalid room is dropped, and a time that is not a whole
  /// number is forgotten.
  static PairingRecord? fromJson(Object? value) {
    if (value is! Map<String, Object?>) return null;
    final host = value['hostParticipantId'], label = value['hostLabel'];
    final room = value['roomId'], at = value['pairedAt'];
    if (host is! String || !isParticipantId(host)) return null;
    final name = label is String ? label.trim() : '';
    return PairingRecord(
      hostParticipantId: host,
      hostLabel: name.isEmpty || name.length > Contract.pairingLabelMaxLength
          ? host
          : name,
      roomId: room is String && isRoomId(room) ? room : null,
      pairedAt: at is int ? at : null,
    );
  }
}
