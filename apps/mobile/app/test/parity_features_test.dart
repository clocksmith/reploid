// Attachments, blocked computers and the data file, checked against the web
// client's real code where one exists: its vectors for attachment text and
// its real importer and exporter for the data file.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/attachments.dart';
import 'package:reploid_mobile/features/chat/infrastructure/chat_repository.dart';
import 'package:reploid_mobile/features/chat/infrastructure/computer_preferences.dart';
import 'package:reploid_mobile/features/chat/infrastructure/conversation_archive.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';

import 'infrastructure/provider_process.dart';
import 'infrastructure/support.dart';

const _fast = Duration(milliseconds: 2);
const _peerA = 'peer:00000000000000000000000a';
const _me = 'peer:abcabcabcabcabcabcabcabc';
final _script =
    '$repositoryRoot/tests/fixtures/requester-conformance/local-data-check.js';

PickedFile _file(String name, String text) =>
    PickedFile(name: name, bytes: Uint8List.fromList(utf8.encode(text)));

Future<(SessionCoordinator, SessionChatRepository)> _open(
  MemoryNetwork network, {
  SecretStore? secrets,
  FileStore? files,
}) async {
  final coordinator = SessionCoordinator();
  await coordinator.activate(const SessionIdentity(_me));
  final session = coordinator.state.session!;
  var next = 0;
  final store = secrets ?? MemorySecretStore();
  final repository = SessionChatRepository(
    session: session,
    api: network.forIdentity(session.key.identity),
    newId: () => 'id-${next++}-${DateTime.now().microsecondsSinceEpoch}',
    archive: ConversationArchive(
      files: files ?? MemoryFileStore(),
      secrets: store,
      participantId: _me,
    ),
    computerPreferences: ComputerPreferencesStore(store, _me),
    participantId: _me,
  );
  await repository.watchNetwork().firstWhere(
    (n) => n.status == NetworkStatus.online,
  );
  return (coordinator, repository);
}

Future<Conversation> _read(SessionChatRepository repository, String id) async =>
    (await repository.watch(id).first).conversation!;

Future<Map<String, Object?>> _webCheck(String text) async {
  final directory = await Directory.systemTemp.createTemp('reploid-data');
  try {
    final file = File('${directory.path}/data.json')..writeAsStringSync(text);
    final result = await Process.run('node', [_script, 'check', file.path]);
    return jsonDecode(result.stdout as String) as Map<String, Object?>;
  } finally {
    await directory.delete(recursive: true);
  }
}

void main() {
  late MemoryNetwork network;
  setUp(() => network = MemoryNetwork(latency: _fast, chunkDelay: _fast));
  final skip = providerUnavailable();

  group('attachment text', () {
    final vectors =
        (jsonDecode(
              File(
                '$repositoryRoot/tests/fixtures/requester-conformance/vectors.json',
              ).readAsStringSync(),
            ) as Map<String, Object?>)['attachments']!
            as Map<String, Object?>;
    for (final raw in vectors['cases']! as List<Object?>) {
      final item = raw! as Map<String, Object?>;
      test('matches the web client: ${item['name']}', () {
        final files = [
          for (final file in (item['files']! as List).cast<Json>())
            AttachedFile(
              name: file['name']! as String,
              text: file['text']! as String,
              bytes: 0,
            ),
        ];
        final input = attachmentInput(item['question']! as String, files);
        expect(input, item['input']);
        final shown = readAttachmentDisplay(input);
        final expected = item['display'] as Map<String, Object?>?;
        expect(shown?.question, expected?['question']);
        expect(shown?.names, expected?['names']);
      });
    }

    test('a file that breaks a limit adds nothing', () {
      final big = PickedFile(name: 'a.txt', bytes: Uint8List(65537));
      final binary = PickedFile(
        name: 'a.txt',
        bytes: Uint8List.fromList([0xff, 0xfe]),
      );
      for (final bad in [
        big,
        binary,
        _file('a.exe', 'x'),
        _file('a.md', ' '),
      ]) {
        expect(
          () => readAttachments([_file('ok.txt', 'fine'), bad], const []),
          throwsA(isA<AppFailure>()),
        );
      }
      expect(
        () => readAttachments([
          for (var i = 0; i < 9; i++) _file('$i.txt', 'x'),
        ], const []),
        throwsA(isA<AppFailure>()),
      );
    });
  });

  test('files go with one prompt and show as their names', () async {
    final (coordinator, repository) = await _open(network);
    final id = repository.create();
    repository
      ..selectModel(id, MemoryNetwork.smallModel)
      ..addAttachments(id, [_file('notes.txt', 'One.\n\nTwo.')]);
    expect((await _read(repository, id)).draftFiles.single.name, 'notes.txt');

    await repository.send(id, 'Summarize');
    final conversation = await _read(repository, id);
    final sent = conversation.turns.first;
    expect(conversation.draftFiles, isEmpty);
    expect(conversation.title, 'Summarize');
    expect(sent.shownText, 'Summarize');
    expect(sent.attachments!.names, ['notes.txt']);
    expect(network.delivered.single.$3, contains('[D1:P1]'));
    expect(network.delivered.single.$3, contains('Two.'));
    await coordinator.dispose();
  });

  test('a blocked computer never gets a prompt, across restarts', () async {
    final secrets = MemorySecretStore();
    final files = MemoryFileStore();
    final (first, repository) = await _open(
      network,
      secrets: secrets,
      files: files,
    );
    final view = await repository.watchNetwork().first;
    await repository.blockComputer(
      view.computers.firstWhere((c) => c.participantId == _peerA),
    );
    await repository.renameComputer(_peerA, 'Lab machine');
    await first.dispose();

    final (second, again) = await _open(
      network,
      secrets: secrets,
      files: files,
    );
    final id = again.create();
    again.selectModel(id, MemoryNetwork.smallModel);
    await pumpEventQueue();
    final reopened = await again.watchNetwork().first;
    expect(reopened.blockedComputers.single.id, _peerA);
    expect(reopened.blockedComputers.single.label, 'Lab machine');
    expect((await _read(again, id)).nextRecipient, isNull);
    await again.send(id, 'private');
    expect(network.delivered, isEmpty);
    expect((await _read(again, id)).turns.last.phase, AnswerPhase.failed);

    await again.unblockComputer(_peerA);
    expect((await _read(again, id)).nextRecipient, _peerA);
    await second.dispose();
  });

  test('an unreadable block list refuses contributors', () async {
    final secrets = MemorySecretStore();
    await secrets.write(
      'reploid.computer-preferences.v1.${_me.replaceAll(RegExp('[^a-z0-9]'), '')}',
      'not json',
    );
    final (coordinator, repository) = await _open(network, secrets: secrets);
    final id = repository.create();
    repository.selectModel(id, MemoryNetwork.smallModel);
    await pumpEventQueue();
    await expectLater(
      () => repository.send(id, 'private'),
      throwsA(
        isA<AppFailure>().having((f) => f.kind, 'kind', FailureKind.forbidden),
      ),
    );
    expect(network.requests, 0);
    await coordinator.dispose();
  });

  test('the phone\'s export is accepted by the web importer', () async {
    final (coordinator, repository) = await _open(network);
    final id = repository.create();
    repository
      ..selectModel(id, MemoryNetwork.smallModel)
      ..addAttachments(id, [_file('notes.txt', 'One.\n\nTwo.')]);
    await repository.send(id, 'Summarize');
    final failed = repository.create();
    repository.selectModel(failed, MemoryNetwork.smallModel);
    network.simulateNext(AnswerBehavior.failMidStream);
    await repository.send(failed, 'This one breaks');
    await repository.renameComputer(_peerA, 'Lab machine');

    final file = await repository.exportData();
    expect(file.omitted, 0);
    for (final secret in ['privateJwk', 'token', 'roomId', 'pairing']) {
      expect(file.text, isNot(contains('"$secret"')));
    }
    final web = await _webCheck(file.text);
    expect(web['ok'], isTrue, reason: '${web['error']}');
    final done = web['done']! as Map<String, Object?>;
    expect(done['conversations'], 2);
    expect(done['names'], 1);
    final threads = web['conversations']! as List<Object?>;
    final statuses = {
      for (final thread in threads)
        for (final attempt in (thread! as Map)['attempts'] as List)
          (attempt as Map)['status'],
    };
    expect(statuses, {'completed', 'failed'});
    await coordinator.dispose();
  }, skip: skip);

  test('a real web export imports here and keeps no authority', () async {
    final exported = await Process.run('node', [_script, 'emit']);
    expect(exported.exitCode, 0);
    final (coordinator, repository) = await _open(network);
    final preview = await repository.previewImport(exported.stdout as String);
    expect(preview.conversations, 2);
    expect(preview.names, 1);
    expect(preview.blocked, 1);
    expect(network.requests, 0);

    final done = await repository.confirmImport();
    expect(done.conversations, 2);
    final list = await repository.watchList().first;
    expect(list.conversations, hasLength(2));
    final answered = list.conversations.firstWhere((c) => c.turns.length == 4);
    final attached = answered.turns[2];
    expect(attached.shownText, 'Summarize this');
    expect(attached.attachments!.names, ['notes.txt']);
    expect(answered.turns.last.phase, AnswerPhase.complete);
    expect(answered.turns.last.receiptVerified, isFalse);
    expect(answered.turns.last.recipient, isNull);
    expect(
      list.conversations
          .firstWhere((c) => c.turns.length == 2)
          .turns
          .last
          .phase,
      AnswerPhase.failed,
    );
    expect(network.requests, 0);

    // A second import changes nothing, and the round trip still parses.
    final repeat = await repository.previewImport(exported.stdout as String);
    expect(repeat.empty, isTrue);
    repository.cancelImport();
    final again = await _webCheck((await repository.exportData()).text);
    expect(again['ok'], isTrue, reason: '${again['error']}');
    await coordinator.dispose();
  }, skip: skip);

  group('a lost answer', () {
    Future<(SessionCoordinator, SessionChatRepository, String)> lost() async {
      final (coordinator, repository) = await _open(network);
      final id = repository.create();
      repository.selectModel(id, MemoryNetwork.smallModel);
      network.simulateNext(AnswerBehavior.loseMidStream);
      await repository.send(id, 'hello there');
      final conversation = await _read(repository, id);
      expect(conversation.turns.last.phase, AnswerPhase.failed);
      expect(conversation.turns.last.promptSent, isTrue);
      expect(conversation.canRecover, isTrue);
      return (coordinator, repository, id);
    }

    test('is recovered without sending the prompt again', () async {
      final (coordinator, repository, id) = await lost();
      final before = network.requests;
      expect(await repository.recover(id), RecoverResult.answered);
      final conversation = await _read(repository, id);
      final answer = conversation.turns.last;
      expect(answer.phase, AnswerPhase.complete);
      expect(answer.text, 'You asked: hello there');
      expect(answer.receiptVerified, isTrue);
      expect(answer.failure, isNull);
      expect(conversation.canRecover, isFalse);
      expect(network.requests, before);
      expect(network.delivered, hasLength(1));
      await coordinator.dispose();
    });

    test('stays recoverable when the computer has no answer yet', () async {
      final (coordinator, repository, id) = await lost();
      network.forgetLostAnswers();
      expect(await repository.recover(id), RecoverResult.notYet);
      expect((await _read(repository, id)).canRecover, isTrue);
      await coordinator.dispose();
    });

    test('stops being recoverable once the computer ended it', () async {
      final (coordinator, repository, id) = await lost();
      network.recoveryEnds = true;
      expect(await repository.recover(id), RecoverResult.ended);
      final conversation = await _read(repository, id);
      expect(conversation.canRecover, isFalse);
      expect(conversation.canRetry, isTrue);
      await coordinator.dispose();
    });

    test('a failure the computer reported is not recoverable', () async {
      final (coordinator, repository) = await _open(network);
      final id = repository.create();
      repository.selectModel(id, MemoryNetwork.smallModel);
      network.simulateNext(AnswerBehavior.failMidStream);
      await repository.send(id, 'hello there');
      expect((await _read(repository, id)).canRecover, isFalse);
      await coordinator.dispose();
    });

    test('an answer cut off by closing the app can be recovered', () async {
      final archive = ConversationArchive(
        files: MemoryFileStore(),
        secrets: MemorySecretStore(),
        participantId: _me,
      );
      await archive.save([
        const ArchivedConversation(
          id: 'c1',
          title: 'hello',
          modelId: MemoryNetwork.smallModel,
          turns: [
            Turn(id: 'u1', role: TurnRole.user, text: 'hello'),
            Turn(
              id: 'a1',
              role: TurnRole.assistant,
              text: 'partial',
              phase: AnswerPhase.streaming,
              recipient: _peerA,
              promptSent: true,
              requestId: 'r1',
              requestModelId: MemoryNetwork.smallModel,
            ),
          ],
        ),
      ]);
      final restored = (await archive.load()).single.turns.last;
      expect(restored.phase, AnswerPhase.failed);
      expect(restored.recoverable, isTrue);
      expect(restored.requestId, 'r1');
    });
  });

  test('files that are not exports are refused', () async {
    final (coordinator, repository) = await _open(network);
    for (final text in [
      'not json',
      '{}',
      '{"schema":"poolday.local-data-export/v1","version":2,"conversations":[]}',
      '{"schema":"poolday.local-data-export/v1","version":1,"conversations":[{"id":"x"}]}',
    ]) {
      await expectLater(
        () => repository.previewImport(text),
        throwsA(
          isA<AppFailure>().having(
            (f) => f.kind,
            'kind',
            FailureKind.validation,
          ),
        ),
      );
    }
    await coordinator.dispose();
  });
}
