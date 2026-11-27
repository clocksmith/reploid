// The paired desktop in the chat feature: on the synthetic network, then
// through the real adapter against the web client's desktop-side code.
import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/chat_repository.dart';
import 'package:reploid_mobile/features/chat/infrastructure/contract_requester_api.dart';
import 'package:reploid_mobile/features/chat/infrastructure/conversation_archive.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';
import 'package:reploid_mobile/features/chat/infrastructure/pairing_store.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_network.dart';

import 'infrastructure/provider_process.dart';
import 'infrastructure/support.dart';

const _fast = Duration(milliseconds: 2);
const _account = 'peer:aaaaaaaaaaaaaaaaaaaaaaaa';

Future<(SessionCoordinator, SessionChatRepository)> _memory(
  MemoryNetwork network, {
  MemoryFileStore? files,
  MemorySecretStore? secrets,
  String ids = 'id',
}) async {
  final coordinator = SessionCoordinator();
  await coordinator.activate(const SessionIdentity(_account));
  final session = coordinator.state.session!;
  var next = 0;
  final repository = SessionChatRepository(
    session: session,
    api: network.forIdentity(session.key.identity),
    newId: () => '$ids-${next++}',
    archive: files == null
        ? null
        : ConversationArchive(
            files: files,
            secrets: secrets!,
            participantId: _account,
          ),
  );
  await repository.watchNetwork().firstWhere(
    (n) => n.status == NetworkStatus.online,
  );
  return (coordinator, repository);
}

Future<Turn> _last(SessionChatRepository repository, String id) async =>
    (await repository.watch(id).first).conversation!.turns.last;

void main() {
  late MemoryNetwork network;
  setUp(() => network = MemoryNetwork(latency: _fast, chunkDelay: _fast));

  test('a link is read without sending, then pairing needs approval', () async {
    final (coordinator, repository) = await _memory(network);
    expect(repository.readInvite('https://replo.id/'), isNull);
    final invite = repository.readInvite(MemoryNetwork.pairingLink)!;
    expect(invite.participantId, MemoryNetwork.desktopId);
    expect(invite.label, MemoryNetwork.desktopLabel);
    expect(network.pairingRequests, 0);

    final seen = <DesktopStatus?>[];
    final subscription = repository.watchNetwork().listen(
      (n) => seen.add(n.desktop?.status),
    );
    await repository.pair(MemoryNetwork.pairingLink);
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await subscription.cancel();
    final desktop = (await repository.watchNetwork().first).desktop!;
    expect(desktop.status, DesktopStatus.online);
    expect(desktop.participantId, MemoryNetwork.desktopId);
    expect(seen.last, DesktopStatus.online);
    await coordinator.dispose();
  });

  test('a paired desktop answers, and only it', () async {
    final (coordinator, repository) = await _memory(network);
    await repository.pair(MemoryNetwork.pairingLink);
    final id = repository.create();
    expect(
      (await repository.watch(id).first).conversation!.target,
      AnswerTarget.desktop,
      reason: 'a new conversation answers on the desktop once one is paired',
    );
    await repository.send(id, 'to my desk');
    final turn = await _last(repository, id);
    expect(turn.phase, AnswerPhase.complete);
    expect(turn.recipient, MemoryNetwork.desktopId);
    expect(network.delivered.single.$2, MemoryNetwork.desktopId);
    await coordinator.dispose();
  });

  test('an offline desktop is never swapped for another computer', () async {
    final (coordinator, repository) = await _memory(network);
    await repository.pair(MemoryNetwork.pairingLink);
    network.setDesktopOnline(false);
    final offline = await repository.watchNetwork().firstWhere(
      (n) => n.desktop?.status == DesktopStatus.offline,
    );
    // A contributor is ready with the same model the whole time.
    expect(offline.models.any((m) => m.available), isTrue);
    final id = repository.create();
    await repository.send(id, 'only for my desk');
    final turn = await _last(repository, id);
    expect(turn.phase, AnswerPhase.failed);
    expect(turn.failure, FailureKind.unavailable);
    expect((turn.recipient, turn.promptSent), (null, false));
    expect(network.delivered, isEmpty);

    // Choosing contributors is the person's own, explicit change.
    repository.selectTarget(id, AnswerTarget.contributors);
    await repository.retry(id);
    final retried = await _last(repository, id);
    expect(retried.phase, AnswerPhase.complete);
    expect(retried.recipient, isNot(MemoryNetwork.desktopId));
    await coordinator.dispose();
  });

  test('a declined or unanswered pairing pairs nothing and says why', () async {
    final (coordinator, repository) = await _memory(network);
    for (final (behavior, kind) in [
      (PairingBehavior.decline, FailureKind.forbidden),
      (PairingBehavior.silent, FailureKind.unavailable),
      (PairingBehavior.missing, FailureKind.unavailable),
    ]) {
      network.simulateNextPairing(behavior);
      await expectLater(
        repository.pair(MemoryNetwork.pairingLink),
        throwsA(isA<AppFailure>().having((f) => f.kind, 'kind', kind)),
      );
      final resource = await repository.watchNetwork().first;
      expect(resource.desktop, isNull, reason: behavior.name);
      expect(resource.pairingFailure, kind, reason: behavior.name);
    }
    await expectLater(
      repository.pair('not a link'),
      throwsA(isA<AppFailure>()),
    );
    await coordinator.dispose();
  });

  test('a desktop that dropped the phone refuses before the prompt', () async {
    final (coordinator, repository) = await _memory(network);
    await repository.pair(MemoryNetwork.pairingLink);
    network.desktopForgot = true;
    final id = repository.create();
    await repository.send(id, 'still mine?');
    final turn = await _last(repository, id);
    expect(turn.phase, AnswerPhase.failed);
    expect(turn.failure, FailureKind.forbidden);
    expect(turn.promptSent, isFalse);
    expect(turn.recipient, MemoryNetwork.desktopId);
    expect(
      (await repository.watchNetwork().first).desktop!.status,
      DesktopStatus.online,
      reason: 'it is the same desktop, not an offline one',
    );
    await coordinator.dispose();
  });

  test('unpairing returns conversations to contributors', () async {
    final (coordinator, repository) = await _memory(network);
    await repository.pair(MemoryNetwork.pairingLink);
    final id = repository.create();
    await repository.unpair();
    expect((await repository.watchNetwork().first).desktop, isNull);
    expect(
      (await repository.watch(id).first).conversation!.target,
      AnswerTarget.contributors,
    );
    expect(
      () => repository.selectTarget(id, AnswerTarget.desktop),
      throwsA(isA<AppFailure>()),
    );
    await coordinator.dispose();
  });

  test(
    'a conversation keeps its chosen destination across a restart',
    () async {
      final files = MemoryFileStore(), secrets = MemorySecretStore();
      var (coordinator, repository) = await _memory(
        network,
        files: files,
        secrets: secrets,
      );
      await repository.pair(MemoryNetwork.pairingLink);
      final id = repository.create();
      repository.selectTarget(id, AnswerTarget.contributors);
      await repository.send(id, 'for a stranger');
      await repository.saved;
      await coordinator.dispose();
      (coordinator, repository) = await _memory(
        network,
        files: files,
        secrets: secrets,
        ids: 'again',
      );
      final restored = (await repository.watchList().firstWhere(
        (l) => l.conversations.isNotEmpty,
      )).conversations.single;
      expect(restored.target, AnswerTarget.contributors);
      await coordinator.dispose();
    },
  );

  group('through the real adapter and the web client’s desktop code', () {
    final skip = providerUnavailable();

    Future<
      (
        SessionCoordinator,
        SessionChatRepository,
        ProcessTransport,
        MemorySecretStore,
        SigningIdentity,
      )
    >
    open(
      List<String> arguments, {
      MemorySecretStore? secrets,
      SigningIdentity? identity,
      ProcessTransport? desk,
    }) async {
      final who = identity ?? await SigningIdentity.generate();
      final store = secrets ?? MemorySecretStore();
      final coordinator = SessionCoordinator();
      await coordinator.activate(SessionIdentity(who.peerId));
      // The desktop waits in its own room: a second connection, opened only
      // when a link or a stored pairing names that room.
      final room = desk ?? ProcessTransport(['--pairing', ...arguments]);
      var next = 0;
      final repository = SessionChatRepository(
        session: coordinator.state.session!,
        api: ContractRequesterApi(
          RequesterNetwork(
            transport: _NoPeers(),
            identity: who,
            discoveryTimeout: const Duration(seconds: 2),
          ),
          pairings: PairingStore(store, who.peerId),
          joinRoom: (roomId, token) => RequesterNetwork(
            transport: room,
            identity: who,
            discoveryTimeout: const Duration(seconds: 2),
          ),
        ),
        newId: () => 'id-${next++}',
      );
      await repository.watchNetwork().firstWhere(
        (n) => n.status == NetworkStatus.online,
      );
      return (coordinator, repository, room, store, who);
    }

    test(
      'pair from a link, ask the desktop, and stay paired after a restart',
      () async {
        final preview = await ProcessLink.start(['--pairing']);
        await preview.stop();
        // The link names a room; the phone is not in it until it pairs.
        var (coordinator, repository, room, store, who) = await open(const []);
        expect((await repository.watchNetwork().first).desktop, isNull);
        expect(room.link, isNull, reason: 'the desktop room is not joined yet');

        // Read the live link from the provider this run will actually meet.
        final live = await _linkOf(room);
        final invite = repository.readInvite(live)!;
        expect(
          invite.label,
          (room.link!.ready['pairing']! as Json)['hostLabel'],
        );
        await repository.pair(live);
        final desktop = await repository.watchNetwork().firstWhere(
          (n) => n.desktop?.status == DesktopStatus.online,
        );
        expect(desktop.desktop!.participantId, invite.participantId);

        final id = repository.create();
        await repository.send(id, 'What is the capital of France?');
        final turn = await _last(repository, id);
        expect(turn.phase, AnswerPhase.complete);
        expect(turn.recipient, invite.participantId);
        expect(turn.receiptVerified, isTrue);
        final answer = (room.link!.ready['answer']! as Json)['content'];
        expect(turn.text, answer);
        await coordinator.dispose();

        // Restart with the same keystore and identity: the pairing is kept,
        // and with the desktop gone it is offline, not replaced.
        (coordinator, repository, room, store, who) = await open(
          const [],
          secrets: store,
          identity: who,
          desk: _NeverConnects(),
        );
        final later = await repository.watchNetwork().firstWhere(
          (n) => n.desktop != null,
        );
        expect(later.desktop!.participantId, invite.participantId);
        expect(later.desktop!.status, DesktopStatus.offline);
        final second = repository.create();
        await repository.send(second, 'anyone?');
        final refused = await _last(repository, second);
        expect(refused.phase, AnswerPhase.failed);
        expect((refused.recipient, refused.promptSent), (null, false));

        await repository.unpair();
        expect((await repository.watchNetwork().first).desktop, isNull);
        expect(await PairingStore(store, who.peerId).read(), isNull);
        await coordinator.dispose();
      },
      skip: skip,
    );

    test('an owner who declines leaves nothing stored', () async {
      final (coordinator, repository, room, store, who) = await open([
        '--pairing-decline',
      ]);
      await expectLater(
        repository.pair(await _linkOf(room)),
        throwsA(
          isA<AppFailure>().having(
            (f) => f.kind,
            'kind',
            FailureKind.forbidden,
          ),
        ),
      );
      final resource = await repository.watchNetwork().first;
      expect(resource.desktop, isNull);
      expect(resource.pairingFailure, FailureKind.forbidden);
      expect(await PairingStore(store, who.peerId).read(), isNull);
      await coordinator.dispose();
    }, skip: skip);
  });
}

/// The provider prints its link when it starts. This starts it once, reads
/// the link, and leaves it running for the pairing that follows.
Future<String> _linkOf(ProcessTransport room) async {
  await room.open();
  return (room.link!.ready['pairing']! as Json)['link']! as String;
}

final class _NoPeers implements MeshTransport {
  @override
  TransportStatus get status => TransportStatus.online;
  @override
  Stream<TransportStatus> get statusChanges => const Stream.empty();
  @override
  Stream<Never> get links => const Stream.empty();
  @override
  Future<void> open() async {}
  @override
  Future<void> close() async {}
}

final class _NeverConnects extends ProcessTransport {
  _NeverConnects();

  @override
  Future<void> open() async {}
  @override
  Future<void> close() async {}
}
