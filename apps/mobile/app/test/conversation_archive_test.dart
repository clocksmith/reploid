import 'dart:convert';
import 'dart:typed_data';

import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/chat_repository.dart';
import 'package:reploid_mobile/features/chat/infrastructure/conversation_archive.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';

const _fast = Duration(milliseconds: 2);

ConversationArchive _archive(
  MemoryFileStore files,
  MemorySecretStore secrets, [
  String participant = 'peer:aaaaaaaaaaaaaaaaaaaaaaaa',
]) => ConversationArchive(
  files: files,
  secrets: secrets,
  participantId: participant,
);

const _sample = ArchivedConversation(
  id: 'c1',
  title: 'SENTINEL-TITLE',
  modelId: 'model',
  turns: [
    Turn(id: 't1', role: TurnRole.user, text: 'SENTINEL-PROMPT'),
    Turn(
      id: 't2',
      role: TurnRole.assistant,
      text: 'SENTINEL-ANSWER',
      phase: AnswerPhase.complete,
      attemptId: 'a1',
      recipient: 'peer:bbbbbbbbbbbbbbbbbbbbbbbb',
      promptSent: true,
      receiptVerified: true,
    ),
  ],
);

Future<(SessionCoordinator, SessionChatRepository)> _open(
  MemoryNetwork network,
  MemoryFileStore files,
  MemorySecretStore secrets, {
  String account = 'peer:aaaaaaaaaaaaaaaaaaaaaaaa',
  String ids = 'id',
}) async {
  final coordinator = SessionCoordinator();
  await coordinator.activate(SessionIdentity(account));
  final session = coordinator.state.session!;
  var next = 0;
  final repository = SessionChatRepository(
    session: session,
    api: network.forIdentity(session.key.identity),
    newId: () => '$ids-${next++}',
    archive: _archive(files, secrets, account),
  );
  await repository.watchNetwork().firstWhere(
    (n) => n.status == NetworkStatus.online,
  );
  return (coordinator, repository);
}

void main() {
  test(
    'history comes back as it was saved, and is unreadable on disk',
    () async {
      final files = MemoryFileStore(), secrets = MemorySecretStore();
      await _archive(files, secrets).save([_sample]);
      final sealed = latin1.decode(files.files.values.single);
      for (final secret in ['SENTINEL', 'peer:bbbb', 'model', 'turns']) {
        expect(sealed.contains(secret), isFalse, reason: secret);
      }
      final restored = (await _archive(files, secrets).load()).single;
      expect(restored.title, 'SENTINEL-TITLE');
      expect(restored.turns.first.text, 'SENTINEL-PROMPT');
      final answer = restored.turns.last;
      expect(answer.text, 'SENTINEL-ANSWER');
      expect(answer.attemptId, 'a1');
      expect((answer.promptSent, answer.receiptVerified), (true, true));
      expect(answer.phase, AnswerPhase.complete);
    },
  );

  test('two saves of the same history never produce the same bytes', () async {
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    final archive = _archive(files, secrets);
    await archive.save([_sample]);
    final first = Uint8List.fromList(files.files.values.single);
    await archive.save([_sample]);
    expect(files.files.values.single, isNot(first));
  });

  test('a changed file or another key opens as no history', () async {
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    await _archive(files, secrets).save([_sample]);
    final name = files.files.keys.single;
    final damaged = Uint8List.fromList(files.files[name]!);
    damaged[damaged.length ~/ 2] ^= 1;
    files.files[name] = damaged;
    expect(await _archive(files, secrets).load(), isEmpty);

    final others = MemoryFileStore();
    await _archive(others, MemorySecretStore()).save([_sample]);
    expect(await _archive(others, MemorySecretStore()).load(), isEmpty);
  });

  test('one identity cannot read another identity’s history', () async {
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    await _archive(files, secrets).save([_sample]);
    expect(
      await _archive(files, secrets, 'peer:cccccccccccccccccccccccc').load(),
      isEmpty,
    );
    expect(files.files, hasLength(1));
  });

  test('history from a newer app version is left untouched', () async {
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    final archive = _archive(files, secrets);
    await archive.save([_sample]);
    // Reseal the same key's file as if a later version had written it.
    final name = files.files.keys.single;
    final newer = _NewerArchive(files, secrets);
    await newer.writeFuture();
    final before = Uint8List.fromList(files.files[name]!);
    final reader = _archive(files, secrets);
    expect(await reader.load(), isEmpty);
    expect(reader.writable, isFalse);
    await reader.save(const []);
    expect(files.files[name], before);
  });

  test('erase removes the history and its key', () async {
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    final archive = _archive(files, secrets);
    await archive.save([_sample]);
    await archive.erase();
    expect(files.files, isEmpty);
    expect(await archive.load(), isEmpty);
    await archive.save([_sample]);
    expect((await archive.load()).single.id, 'c1');
  });

  test('conversations survive a restart', () async {
    final network = MemoryNetwork(latency: _fast, chunkDelay: _fast);
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    var (coordinator, repository) = await _open(network, files, secrets);
    final id = repository.create();
    await repository.send(id, 'remember this');
    final empty = repository.create(); // never written: it has no turns
    await repository.saved;
    await coordinator.dispose();

    (coordinator, repository) = await _open(
      network,
      files,
      secrets,
      ids: 'second',
    );
    final list = await repository.watchList().firstWhere(
      (l) => l.conversations.isNotEmpty,
    );
    expect(list.conversations.map((c) => c.id), [id]);
    expect(list.conversations.map((c) => c.id), isNot(contains(empty)));
    final turns = list.conversations.single.turns;
    expect(turns.first.text, 'remember this');
    expect(turns.last.text, 'You asked: remember this');
    expect(turns.last.phase, AnswerPhase.complete);
    expect(turns.last.receiptVerified, isTrue);
    expect(network.requests, 1, reason: 'reopening sends nothing');

    // The restored conversation continues, and the follow-up is saved too.
    await repository.send(id, 'and this');
    await repository.saved;
    await coordinator.dispose();
    (coordinator, repository) = await _open(
      network,
      files,
      secrets,
      ids: 'third',
    );
    final again = await repository.watchList().firstWhere(
      (l) => l.conversations.isNotEmpty,
    );
    expect(again.conversations.single.turns, hasLength(4));
    await coordinator.dispose();
  });

  test('an answer cut off by the app closing is never resent', () async {
    final network = MemoryNetwork(
      latency: _fast,
      chunkDelay: const Duration(milliseconds: 40),
    );
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    var (coordinator, repository) = await _open(network, files, secrets);
    final id = repository.create();
    final sending = repository.send(id, 'a b c d e f g h');
    await repository
        .watch(id)
        .firstWhere((r) => (r.conversation?.turns.last.text ?? '').isNotEmpty);
    await coordinator.dispose(); // the process ends mid-answer
    await sending;

    (coordinator, repository) = await _open(
      network,
      files,
      secrets,
      ids: 'next',
    );
    final restored = (await repository.watchList().firstWhere(
      (l) => l.conversations.isNotEmpty,
    )).conversations.single;
    final answer = restored.turns.last;
    expect(answer.phase, AnswerPhase.failed);
    expect(answer.promptSent, isTrue, reason: 'the person is still told');
    expect(answer.text, isNotEmpty);
    expect(restored.canRetry, isTrue);
    await Future<void>.delayed(const Duration(milliseconds: 150));
    expect(network.requests, 1, reason: 'nothing is resent on its own');
    await coordinator.dispose();
  });

  test(
    'asking again is a new attempt that an old one cannot overwrite',
    () async {
      final network = MemoryNetwork(
        latency: _fast,
        chunkDelay: const Duration(milliseconds: 30),
      );
      final files = MemoryFileStore(), secrets = MemorySecretStore();
      final (coordinator, repository) = await _open(network, files, secrets);
      final id = repository.create();
      final first = repository.send(id, 'a b c d e f g h');
      await repository
          .watch(id)
          .firstWhere(
            (r) => (r.conversation?.turns.last.text ?? '').isNotEmpty,
          );
      final firstAttempt =
          (await repository.watch(id).first).conversation!.turns.last.attemptId;
      await repository.stop(id);
      await first;
      await repository.retry(id);
      final turns = (await repository.watch(id).first).conversation!.turns;
      expect(turns, hasLength(2));
      expect(turns.last.attemptId, isNot(firstAttempt));
      expect(turns.last.phase, AnswerPhase.complete);
      expect(turns.last.text, 'You asked: a b c d e f g h');
      await Future<void>.delayed(const Duration(milliseconds: 300));
      final later = (await repository.watch(id).first).conversation!.turns.last;
      expect(later.phase, AnswerPhase.complete);
      expect(later.text, 'You asked: a b c d e f g h');
      await coordinator.dispose();
    },
  );

  test('two conversations answer at once without mixing', () async {
    final network = MemoryNetwork(
      latency: _fast,
      chunkDelay: const Duration(milliseconds: 10),
    );
    network.setComputers([
      for (final name in ['a', 'b'])
        Computer(
          address: 'memory-$name',
          participantId: 'peer:0000000000000000000000c$name',
          modelId: MemoryNetwork.smallModel,
          ready: true,
          busy: false,
        ),
    ]);
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    final (coordinator, repository) = await _open(network, files, secrets);
    final one = repository.create(), two = repository.create();
    await Future.wait([
      repository.send(one, 'first thread'),
      repository.send(two, 'second thread'),
    ]);
    final a = (await repository.watch(one).first).conversation!.turns.last;
    final b = (await repository.watch(two).first).conversation!.turns.last;
    expect(a.text, 'You asked: first thread');
    expect(b.text, 'You asked: second thread');
    expect(a.attemptId, isNot(b.attemptId));
    await coordinator.dispose();
  });

  test('deleting a conversation removes it from disk', () async {
    final network = MemoryNetwork(latency: _fast, chunkDelay: _fast);
    final files = MemoryFileStore(), secrets = MemorySecretStore();
    var (coordinator, repository) = await _open(network, files, secrets);
    final id = repository.create();
    await repository.send(id, 'to be deleted');
    repository.remove(id);
    await repository.saved;
    await coordinator.dispose();
    (coordinator, repository) = await _open(network, files, secrets, ids: 'x');
    await Future<void>.delayed(const Duration(milliseconds: 50));
    expect((await repository.watchList().first).conversations, isEmpty);
    await coordinator.dispose();
  });
}

/// Writes a file the current version must refuse to interpret.
final class _NewerArchive {
  _NewerArchive(this.files, this.secrets);
  final MemoryFileStore files;
  final MemorySecretStore secrets;

  Future<void> writeFuture() async {
    final archive = _FutureSchema(files, secrets);
    await archive.save(const []);
  }
}

final class _FutureSchema extends ConversationArchive {
  _FutureSchema(MemoryFileStore files, MemorySecretStore secrets)
    : super(
        files: files,
        secrets: secrets,
        participantId: 'peer:aaaaaaaaaaaaaaaaaaaaaaaa',
      );

  @override
  int get schemaVersion => ConversationArchive.schema + 1;
}
