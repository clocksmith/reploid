import 'dart:convert';

import 'package:core/core.dart';

import '../../../infrastructure/reploid_api/canonical_json.dart';
import '../../../infrastructure/reploid_api/contract.g.dart';
import '../domain/chat.dart';

// ECMAScript whitespace, because String.trim in Dart also strips U+0085 and
// the web client's does not: the two must produce the same passages.
final _edges = RegExp(r'^\s+|\s+$');
final _paragraphBreak = RegExp(r'\n\s*\n');
String _jsTrim(String text) => text.replaceAll(_edges, '');

/// Procedure `attachmentInput`, reading step: the limits, then strict UTF-8.
/// Throws [FailureKind.validation] and adds nothing when any file fails.
List<AttachedFile> readAttachments(
  List<PickedFile> chosen,
  List<AttachedFile> existing,
) {
  final total =
      chosen.fold<int>(0, (sum, file) => sum + file.bytes.length) +
      existing.fold<int>(0, (sum, file) => sum + file.bytes);
  if (chosen.length + existing.length > Contract.attachmentsMaxFiles ||
      total > Contract.attachmentsMaxInputBytes ||
      chosen.any(
        (file) =>
            file.bytes.length > Contract.attachmentsMaxFileBytes ||
            file.name.isEmpty ||
            file.name.length > Contract.attachmentsMaxNameCharacters ||
            !Contract.attachmentsExtensions.contains(
              file.name.split('.').last.toLowerCase(),
            ),
      )) {
    throw const AppFailure(FailureKind.validation);
  }
  try {
    return [
      for (final file in chosen)
        () {
          final text = utf8.decode(file.bytes);
          if (_jsTrim(text).isEmpty) {
            throw const FormatException('A file with no text');
          }
          return AttachedFile(
            name: file.name,
            text: text,
            bytes: file.bytes.length,
          );
        }(),
    ];
  } on FormatException catch (error) {
    throw AppFailure(FailureKind.validation, cause: error);
  }
}

/// Procedure `attachmentInput`: the text sent as the user message.
String attachmentInput(String question, List<AttachedFile> files) {
  if (files.isEmpty) return question;
  final documents = <Object?>[
    for (final (index, file) in files.indexed)
      <String, Object?>{
        'id': 'D${index + 1}',
        'name': file.name,
        'passages': <Object?>[
          for (final (p, text) in _jsTrim(
            file.text,
          ).split(_paragraphBreak).where((piece) => piece.isNotEmpty).indexed)
            <String, Object?>{'id': 'D${index + 1}:P${p + 1}', 'text': text},
        ],
      },
  ];
  return question +
      Contract.attachmentsInstruction +
      Contract.attachmentsStartMarker +
      jsJson(documents) +
      Contract.attachmentsEndMarker;
}

/// Procedure `attachmentDisplay`: the question and file names of a stored
/// user message, or null when it is plain text.
TurnAttachments? readAttachmentDisplay(String content) {
  final start = content.indexOf(Contract.attachmentsStartMarker);
  final end = content.lastIndexOf(Contract.attachmentsEndMarker);
  if (start < 0 || end < start) return null;
  try {
    final decoded = jsonDecode(
      content.substring(start + Contract.attachmentsStartMarker.length, end),
    );
    if (decoded is! List || decoded.isEmpty || decoded.length > 8) return null;
    final names = <String>[];
    final seen = <String>{};
    for (final (index, document) in decoded.indexed) {
      if (document is! Map ||
          document['id'] != 'D${index + 1}' ||
          document['name'] is! String ||
          document['passages'] is! List) {
        return null;
      }
      for (final (p, passage) in (document['passages'] as List).indexed) {
        final id = passage is Map ? passage['id'] : null;
        if (id != 'D${index + 1}:P${p + 1}' ||
            passage is! Map ||
            passage['text'] is! String ||
            !seen.add(id as String)) {
          return null;
        }
      }
      names.add(document['name'] as String);
    }
    var question = content.substring(0, start);
    if (question.endsWith(Contract.attachmentsInstruction)) {
      question = question.substring(
        0,
        question.length - Contract.attachmentsInstruction.length,
      );
    }
    return TurnAttachments(question: question, names: names);
  } on FormatException {
    return null;
  }
}
