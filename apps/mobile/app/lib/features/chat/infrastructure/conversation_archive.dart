import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:core/core.dart';
import 'package:cryptography/cryptography.dart';

import '../../../infrastructure/device_stores.dart';
import '../domain/chat.dart';

/// One conversation as kept on the device.
final class ArchivedConversation {
  const ArchivedConversation({
    required this.id,
    required this.title,
    required this.modelId,
    required this.turns,
  });
  final String id;
  final String title;
  final String? modelId;
  final List<Turn> turns;
}

/// The conversations of one device identity, encrypted at rest.
///
/// What is kept: conversation ids and titles, the chosen model, and each
/// turn's text, phase, recipient, and whether its prompt was sent and its
/// receipt verified. Where: one file in the app's private directory, sealed
/// with AES-256-GCM under a random key held in the platform keystore. How
/// long: until the conversation is deleted or this device is forgotten,
/// which removes the file and the key. Each identity has its own file and
/// key, so one identity can never read another's history.
///
/// The file is not yet excluded from device backups; the key is, because
/// the keystore is. A backup alone therefore cannot be read.
base class ConversationArchive {
  ConversationArchive({
    required this.files,
    required this.secrets,
    required String participantId,
    Random? random,
  }) : _name = 'history-${_tag(participantId)}.bin',
       _keyName = 'reploid.history-key.v1.${_tag(participantId)}',
       _random = random ?? Random.secure();

  final FileStore files;
  final SecretStore secrets;
  final String _name;
  final String _keyName;
  final Random _random;
  static const schema = 1;

  /// The version written into the file. A later version of the app
  /// writes a higher number.
  int get schemaVersion => schema;
  static final _cipher = AesGcm.with256bits();

  static String _tag(String participantId) =>
      participantId.replaceAll(RegExp('[^a-z0-9]'), '');

  /// False once a file from a newer app version was found. Nothing is
  /// written then, so a downgrade cannot destroy newer history.
  bool writable = true;

  List<int> _bytes(int count) =>
      List<int>.generate(count, (_) => _random.nextInt(256));

  Future<SecretKey> _key({required bool create}) async {
    final stored = await secrets.read(_keyName);
    if (stored != null) return SecretKey(base64Decode(stored));
    if (!create) throw const FormatException('The history key is missing');
    final bytes = _bytes(32);
    await secrets.write(_keyName, base64Encode(bytes));
    return SecretKey(bytes);
  }

  /// The stored conversations; empty when there are none or the file
  /// cannot be opened with this device's key.
  Future<List<ArchivedConversation>> load() async {
    final sealed = await files.read(_name);
    if (sealed == null) return const [];
    try {
      final box = SecretBox.fromConcatenation(
        sealed,
        nonceLength: 12,
        macLength: 16,
      );
      final clear = await _cipher.decrypt(
        box,
        secretKey: await _key(create: false),
      );
      final decoded = jsonDecode(utf8.decode(clear));
      if (decoded is! Map<String, Object?>) return const [];
      final version = decoded['schema'];
      if (version is! int || version > schema) {
        writable = false;
        return const [];
      }
      return [
        for (final item in decoded['conversations']! as List)
          _conversation(item as Map<String, Object?>),
      ];
    } on SecretBoxAuthenticationError {
      return const []; // tampered, or sealed under another key
    } on FormatException {
      return const [];
    } on TypeError {
      return const [];
    }
  }

  Future<void> save(Iterable<ArchivedConversation> conversations) async {
    if (!writable) return;
    final clear = utf8.encode(
      jsonEncode({
        'schema': schemaVersion,
        'conversations': [
          for (final conversation in conversations)
            {
              'id': conversation.id,
              'title': conversation.title,
              'modelId': conversation.modelId,
              'turns': [for (final turn in conversation.turns) _turn(turn)],
            },
        ],
      }),
    );
    final box = await _cipher.encrypt(
      clear,
      secretKey: await _key(create: true),
      nonce: _bytes(12),
    );
    await files.write(_name, Uint8List.fromList(box.concatenation()));
  }

  /// Removes the history and its key. Used when the device is forgotten.
  Future<void> erase() async {
    await files.delete(_name);
    await secrets.delete(_keyName);
  }

  static Map<String, Object?> _turn(Turn turn) => {
    'id': turn.id,
    'role': turn.role.name,
    'text': turn.text,
    'phase': turn.phase?.name,
    'attemptId': turn.attemptId,
    'recipient': turn.recipient,
    'promptSent': turn.promptSent,
    'receiptVerified': turn.receiptVerified,
    'failure': turn.failure?.name,
  };

  static ArchivedConversation _conversation(Map<String, Object?> item) =>
      ArchivedConversation(
        id: item['id']! as String,
        title: item['title']! as String,
        modelId: item['modelId'] as String?,
        turns: [
          for (final raw in item['turns']! as List)
            _restore(raw as Map<String, Object?>),
        ],
      );

  static Turn _restore(Map<String, Object?> raw) {
    final phase = AnswerPhase.values
        .where((p) => p.name == raw['phase'])
        .firstOrNull;
    final turn = Turn(
      id: raw['id']! as String,
      role: TurnRole.values.byName(raw['role']! as String),
      text: raw['text']! as String,
      phase: phase,
      attemptId: raw['attemptId'] as String?,
      recipient: raw['recipient'] as String?,
      promptSent: raw['promptSent'] == true,
      receiptVerified: raw['receiptVerified'] == true,
      failure: FailureKind.values
          .where((k) => k.name == raw['failure'])
          .firstOrNull,
    );
    // An answer that was under way when the app stopped is over. It is
    // never resumed or resent on its own; the person may ask again.
    return turn.inProgress
        ? turn.copyWith(
            phase: AnswerPhase.failed,
            failure: FailureKind.unavailable,
          )
        : turn;
  }
}
