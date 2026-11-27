import 'dart:convert';
import 'dart:typed_data';

import 'package:core/core.dart';
import 'package:file_picker/file_picker.dart';

import '../features/chat/domain/chat.dart';
import 'reploid_api/contract.g.dart';

/// The system's file dialogs. A file is read only after the person chose
/// it, and one over the limit is refused without being read.
final class PlatformDocumentPicker implements DocumentPicker {
  const PlatformDocumentPicker();

  static Future<PickedFile> _read(PlatformFile file, int limit) async {
    final length = await file.length();
    if (length == null || length > limit) {
      throw const AppFailure(FailureKind.validation);
    }
    return PickedFile(name: file.name, bytes: await file.readAsBytes());
  }

  @override
  Future<List<PickedFile>> pickAttachments() async {
    final files = await FilePicker.pickFiles();
    return [
      for (final file in files)
        await _read(file, Contract.attachmentsMaxFileBytes),
    ];
  }

  @override
  Future<PickedFile?> pickDataFile() async {
    final files = await FilePicker.pickFiles();
    return files.isEmpty
        ? null
        : _read(files.first, Contract.localDataMaxBytes);
  }

  @override
  Future<bool> save(String name, String text) async {
    final saved = await FilePicker.saveFile(
      fileName: name,
      bytes: Uint8List.fromList(utf8.encode(text)),
      mimeType: 'application/json',
    );
    return saved != null;
  }
}
