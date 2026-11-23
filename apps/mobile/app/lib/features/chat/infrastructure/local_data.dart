import 'dart:convert';

import 'package:core/core.dart';

import '../../../infrastructure/reploid_api/contract.g.dart';
import '../domain/chat.dart';
import 'conversation_archive.dart';
import 'requester_api.dart';

const _note =
    'Conversations, local computer names and blocked computers from one '
    'phone. This file does not contain private keys, sign-in or relay '
    'credentials, room tokens, pairings, remote permissions, or model '
    'weights. It is not encrypted: anyone with this file can read the '
    'conversations in it.';
const _receiptsNote =
    'This phone keeps no separate receipt store. Whether a signed receipt '
    'verified is kept with each answer on the phone and is not exported.';

final _participant = RegExp(r'^peer:[a-f0-9]{24}$');
final _modelIdentity = RegExp(r'^sha256:[a-f0-9]{64}$');
final _control = RegExp('[\u0000-\u001f\u007f]');
bool _short(Object? value) =>
    value is String && value.isNotEmpty && value.length <= 128;

bool validComputerName(String id, String name) =>
    _participant.hasMatch(id) &&
    name.trim().isNotEmpty &&
    name.length <= Contract.localDataMaxLabelLength &&
    !_control.hasMatch(name);

bool validComputerId(String id) =>
    id.isNotEmpty &&
    id.length <= Contract.localDataMaxComputerIdLength &&
    !_control.hasMatch(id);

/// What a data file would add. Nothing has been changed yet.
final class LocalDataPlan {
  const LocalDataPlan({
    required this.conversations,
    required this.conversationsSkipped,
    required this.names,
    required this.namesSkipped,
    required this.blocked,
    required this.blockedSkipped,
  });
  final List<ArchivedConversation> conversations;
  final int conversationsSkipped;
  final Map<String, String> names;
  final int namesSkipped;
  final List<String> blocked;
  final int blockedSkipped;

  ImportPreview get preview => ImportPreview(
    conversations: conversations.length,
    conversationsSkipped: conversationsSkipped,
    names: names.length,
    namesSkipped: namesSkipped,
    blocked: blocked.length,
    blockedSkipped: blockedSkipped,
  );
}

String _status(Turn turn) => switch (turn.phase) {
  AnswerPhase.complete => 'completed',
  AnswerPhase.stopped => 'cancelled',
  AnswerPhase.failed => 'failed',
  _ => 'interrupted',
};

/// Procedure `localDataExport`. A conversation whose model cannot be named
/// by its identity is left out, and counted, because the format needs one.
({String file, int omitted}) encodeLocalData({
  required String participantId,
  required List<ArchivedConversation> conversations,
  required List<CatalogModel> catalog,
  required Map<String, String> names,
  required List<String> blocked,
  required DateTime now,
}) {
  var omitted = 0;
  final written = <Object?>[];
  for (final conversation in conversations) {
    final known = catalog
        .where((model) => model.id == conversation.modelId)
        .firstOrNull;
    final identity = known?.identity ?? conversation.modelIdentity;
    final id = conversation.modelId;
    if (id == null || identity == null || !_modelIdentity.hasMatch(identity)) {
      omitted++;
      continue;
    }
    final messages = <Object?>[];
    final attempts = <Object?>[];
    String? lastUser;
    for (final turn in conversation.turns) {
      if (turn.role == TurnRole.user) {
        lastUser = turn.id;
        messages.add({
          'id': turn.id,
          'role': 'user',
          'content': turn.text,
          'status': 'completed',
        });
        continue;
      }
      final attemptId = turn.attemptId ?? 'attempt-${turn.id}';
      final status = _status(turn);
      messages.add({
        'id': turn.id,
        'attemptId': attemptId,
        'role': 'assistant',
        'content': turn.text,
        'status': status,
      });
      attempts.add({
        'id': attemptId,
        'threadId': conversation.id,
        'userMessageId': lastUser,
        'responseId': turn.id,
        'status': status,
      });
    }
    written.add({
      'id': conversation.id,
      if (conversation.title.trim().isNotEmpty) 'title': conversation.title,
      'model': {
        'id': id,
        'name': known?.name ?? conversation.modelName ?? id,
        'identity': identity,
      },
      'purpose': '',
      'permissions': {'sharingScope': 'mesh', 'executionLocation': 'network'},
      'messages': messages,
      'attempts': attempts,
    });
  }
  final file = const JsonEncoder.withIndent('  ').convert({
    'schema': Contract.localDataSchema,
    'version': Contract.localDataVersion,
    'exportedAt': now.toUtc().toIso8601String(),
    'note': _note,
    'history': {'meshId': 'reploid-mobile', 'participantId': participantId},
    'conversations': written,
    'computers': {'names': names, 'blocked': blocked},
    'receipts': {'stored': false, 'note': _receiptsNote},
  });
  return (file: file, omitted: omitted);
}

Never _invalid([Object? cause]) =>
    throw AppFailure(FailureKind.validation, cause: cause);

AnswerPhase _phase(Object? status) => switch (status) {
  'completed' => AnswerPhase.complete,
  'cancelled' => AnswerPhase.stopped,
  _ => AnswerPhase.failed,
};

ArchivedConversation _conversation(Map<Object?, Object?> source) {
  final id = source['id'];
  final model = source['model'];
  final messages = source['messages'];
  final attempts = source['attempts'];
  if (!_short(id) || model is! Map || messages is! List || attempts is! List) {
    _invalid();
  }
  final modelId = model['id'];
  final modelName = model['name'];
  final identity = model['identity'];
  if (modelId is! String ||
      modelId.isEmpty ||
      modelName is! String ||
      identity is! String ||
      !_modelIdentity.hasMatch(identity)) {
    _invalid();
  }
  final attemptFor = <String, String>{};
  final attemptIds = <String>{};
  for (final attempt in attempts) {
    if (attempt is! Map ||
        !_short(attempt['id']) ||
        attempt['status'] is! String ||
        !attemptIds.add(attempt['id']! as String)) {
      _invalid();
    }
    if (attempt['responseId'] case final String response) {
      attemptFor[response] = attempt['id']! as String;
    }
  }
  final seen = <String>{};
  final turns = <Turn>[];
  for (final message in messages) {
    if (message is! Map ||
        !_short(message['id']) ||
        message['content'] is! String ||
        !seen.add(message['id']! as String)) {
      _invalid();
    }
    final text = message['content']! as String;
    switch (message['role']) {
      case 'user':
        turns.add(
          Turn(id: message['id']! as String, role: TurnRole.user, text: text),
        );
      case 'assistant':
        final phase = _phase(message['status']);
        turns.add(
          Turn(
            id: message['id']! as String,
            role: TurnRole.assistant,
            text: text,
            phase: phase,
            attemptId:
                attemptFor[message['id']] ?? message['attemptId'] as String?,
            // A file proves nothing about who answered. It is assumed that
            // an imported prompt did leave the device it was written on.
            promptSent: true,
            failure: phase == AnswerPhase.failed
                ? FailureKind.unavailable
                : null,
          ),
        );
      case 'system':
        break; // context of the web workspace; this app has no such turn
      default:
        _invalid();
    }
  }
  final title = source['title'];
  final firstUser = turns.where((t) => t.role == TurnRole.user).firstOrNull;
  return ArchivedConversation(
    id: id! as String,
    title: title is String && title.trim().isNotEmpty
        ? title
        : firstUser == null
        ? ''
        : _titleOf(firstUser.text),
    modelId: modelId,
    modelName: modelName,
    modelIdentity: identity,
    turns: turns,
  );
}

String _titleOf(String content) {
  final end = content.indexOf(Contract.attachmentsInstruction);
  final text = end < 0 ? content : content.substring(0, end);
  return text.length > 48 ? '${text.substring(0, 48)}…' : text;
}

/// Procedure `localDataExport`, import side. Validates the whole file and
/// counts what it would add; throws [FailureKind.validation] if it cannot.
LocalDataPlan readLocalData(
  String text, {
  required Set<String> knownConversations,
  required Map<String, String> knownNames,
  required Set<String> knownBlocked,
}) {
  if (utf8.encode(text).length > Contract.localDataMaxBytes) _invalid();
  final Object? decoded;
  try {
    decoded = jsonDecode(text);
  } on FormatException catch (error) {
    _invalid(error);
  }
  if (decoded is! Map ||
      decoded['schema'] != Contract.localDataSchema ||
      decoded['version'] != Contract.localDataVersion ||
      decoded['conversations'] is! List) {
    _invalid();
  }
  final computers = decoded['computers'] ?? const <String, Object?>{};
  if (computers is! Map) _invalid();
  final names = computers['names'] ?? const <String, Object?>{};
  final blocked = computers['blocked'] ?? const <Object?>[];
  if (names is! Map || blocked is! List) _invalid();

  final added = <ArchivedConversation>[];
  final ids = {...knownConversations};
  var skipped = 0;
  for (final source in decoded['conversations'] as List) {
    if (source is! Map) _invalid();
    final conversation = _conversation(source);
    if (ids.add(conversation.id)) {
      added.add(conversation);
    } else {
      skipped++;
    }
  }

  final addNames = <String, String>{};
  var namesSkipped = 0;
  for (final MapEntry(:key, :value) in names.entries) {
    if (key is! String || value is! String || !validComputerName(key, value)) {
      _invalid();
    }
    if (knownNames.containsKey(key)) {
      namesSkipped++;
    } else {
      addNames[key] = value;
    }
  }
  if (knownNames.length + addNames.length >
      Contract.localDataMaxComputerNames) {
    _invalid();
  }

  final addBlocked = <String>[];
  final uniqueBlocked = <String>{};
  var blockedSkipped = 0;
  for (final id in blocked) {
    if (id is! String || !validComputerId(id)) _invalid();
    if (!uniqueBlocked.add(id)) continue;
    if (knownBlocked.contains(id)) {
      blockedSkipped++;
    } else {
      addBlocked.add(id);
    }
  }
  if (knownBlocked.length + addBlocked.length > Contract.localDataMaxBlocked) {
    _invalid();
  }
  return LocalDataPlan(
    conversations: added,
    conversationsSkipped: skipped,
    names: addNames,
    namesSkipped: namesSkipped,
    blocked: addBlocked,
    blockedSkipped: blockedSkipped,
  );
}
