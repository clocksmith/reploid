// The chat repository, the feature adapter and the protocol engine together,
// answering from the web client's real provider code. Only the transport is
// replaced: a text pipe stands in for signaling and WebRTC.
import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/chat_repository.dart';
import 'package:reploid_mobile/features/chat/infrastructure/contract_requester_api.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_network.dart';

import 'infrastructure/provider_process.dart';
import 'infrastructure/support.dart';

Future<(SessionCoordinator, SessionChatRepository, ProcessTransport)> _open([
  List<String> arguments = const [],
]) async {
  final identity = await SigningIdentity.generate();
  final coordinator = SessionCoordinator();
  await coordinator.activate(SessionIdentity(identity.peerId));
  final transport = ProcessTransport(arguments);
  var next = 0;
  final repository = SessionChatRepository(
    session: coordinator.state.session!,
    api: ContractRequesterApi(
      RequesterNetwork(
        transport: transport,
        identity: identity,
        discoveryTimeout: const Duration(seconds: 10),
      ),
    ),
    newId: () => 'id-${next++}',
  );
  return (coordinator, repository, transport);
}

void main() {
  final skip = providerUnavailable();

  test(
    'the app asks and shows a verified answer from the real provider',
    () async {
      final (coordinator, repository, transport) = await _open();
      final network = await repository.watchNetwork().firstWhere(
        (n) => n.models.any((m) => m.available),
      );
      final provider = transport.link!.provider;
      final answer = transport.link!.ready['answer']! as Json;
      final model = transport.link!.ready['model']! as Json;
      expect(network.status, NetworkStatus.online);
      expect(network.models.where((m) => m.available).single.id, model['id']);
      // The list of computers names the provider once it has proven itself.
      final listed = await repository.watchNetwork().firstWhere(
        (n) => n.computers.any((c) => c.participantId != null),
      );
      expect(listed.computers.single.participantId, provider['participantId']);
      expect(listed.computers.single.ready, isTrue);

      final id = repository.create();
      repository.selectModel(id, model['id']! as String);
      final phases = <AnswerPhase?>[];
      final subscription = repository.watch(id).listen((resource) {
        final turns = resource.conversation?.turns ?? const <Turn>[];
        if (turns.length == 2 && phases.lastOrNull != turns.last.phase) {
          phases.add(turns.last.phase);
        }
      });
      await repository.send(id, 'What is the capital of France?');
      await subscription.cancel();
      final turn = (await repository.watch(id).first).conversation!.turns.last;
      expect(turn.phase, AnswerPhase.complete);
      expect(turn.text, answer['content']);
      expect(turn.recipient, provider['participantId']);
      expect(turn.receiptVerified, isTrue);
      expect(turn.promptSent, isTrue);
      expect(phases, [
        AnswerPhase.finding,
        AnswerPhase.admitting,
        AnswerPhase.streaming,
        AnswerPhase.complete,
      ]);

      // A follow-up carries the earlier turns and is answered again.
      await repository.send(id, 'And of Italy?');
      final turns = (await repository.watch(id).first).conversation!.turns;
      expect(turns, hasLength(4));
      expect(turns.last.phase, AnswerPhase.complete);
      await coordinator.dispose();
    },
    skip: skip,
  );

  test('a provider that declines leaves the prompt on the device', () async {
    final (coordinator, repository, transport) = await _open(['--decline']);
    await repository.watchNetwork().firstWhere(
      (n) => n.models.any((m) => m.available),
    );
    final id = repository.create();
    repository.selectModel(
      id,
      (transport.link!.ready['model']! as Json)['id']! as String,
    );
    await repository.send(id, 'a private question');
    final turn = (await repository.watch(id).first).conversation!.turns.last;
    expect(turn.phase, AnswerPhase.failed);
    expect(turn.failure, FailureKind.forbidden);
    expect(turn.promptSent, isFalse);
    expect(turn.recipient, transport.link!.provider['participantId']);
    await coordinator.dispose();
  }, skip: skip);

  test('stop ends the answer at the provider and keeps what arrived', () async {
    final (coordinator, repository, transport) = await _open([
      '--chunk-delay-ms',
      '250',
    ]);
    await repository.watchNetwork().firstWhere(
      (n) => n.models.any((m) => m.available),
    );
    final id = repository.create();
    repository.selectModel(
      id,
      (transport.link!.ready['model']! as Json)['id']! as String,
    );
    final sending = repository.send(id, 'What is the capital of France?');
    await repository
        .watch(id)
        .firstWhere((r) => (r.conversation?.turns.last.text ?? '').isNotEmpty);
    await repository.stop(id);
    await sending;
    final turn = (await repository.watch(id).first).conversation!.turns.last;
    expect(turn.phase, AnswerPhase.stopped);
    expect(turn.text, isNotEmpty);
    expect(turn.failure, isNull);
    await coordinator.dispose();
  }, skip: skip);

  test('no ready computer fails after the wait without sending', () async {
    final identity = await SigningIdentity.generate();
    final coordinator = SessionCoordinator();
    await coordinator.activate(SessionIdentity(identity.peerId));
    var next = 0;
    final repository = SessionChatRepository(
      session: coordinator.state.session!,
      api: ContractRequesterApi(
        RequesterNetwork(
          transport: _EmptyTransport(),
          identity: identity,
          discoveryTimeout: const Duration(milliseconds: 200),
        ),
      ),
      newId: () => 'id-${next++}',
    );
    final id = repository.create();
    await repository.send(id, 'anyone there?');
    final turn = (await repository.watch(id).first).conversation!.turns.last;
    expect(turn.phase, AnswerPhase.failed);
    expect(turn.failure, FailureKind.unavailable);
    expect((turn.recipient, turn.promptSent), (null, false));
    await coordinator.dispose();
  });
}

final class _EmptyTransport implements MeshTransport {
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
