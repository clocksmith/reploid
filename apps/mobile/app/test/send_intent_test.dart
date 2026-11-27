import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/chat_repository.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/contract.g.dart';

const _digestA =
    'sha256:1111111111111111111111111111111111111111111111111111111111111111';
const _digestB =
    'sha256:2222222222222222222222222222222222222222222222222222222222222222';
const _fast = Duration(milliseconds: 1);

Future<(SessionCoordinator, SessionHandle)> _session(String id) async {
  final coordinator = SessionCoordinator();
  await coordinator.activate(SessionIdentity(id));
  return (coordinator, coordinator.state.session!);
}

void main() {
  test(
    'SendIntent reads contract constants and enforces all four refusals',
    () {
      expect(Contract.sendIntentSchema, 'reploid.send-intent/1');
      expect(Contract.sendIntentTtlMs, 30000);
      expect(Contract.sendIntentRefusals, [
        'expired',
        'selection-changed',
        'artifact-mismatch',
        'thread-changed',
      ]);

      final pinned = SendIntent(
        schema: Contract.sendIntentSchema,
        intentId: 'intent-1',
        threadId: 'thread-1',
        selection: PinnedSendSelection(SendIntentArtifact(identity: _digestA)),
        selectionRevision: 2,
        createdAtMs: 1000,
        ttlMs: Contract.sendIntentTtlMs,
      );

      expect(pinned.expiresAtMs, 31000);
      expect(
        pinned.refusal(
          nowMs: 30999,
          selectionRevision: 2,
          artifact: SendIntentArtifact(identity: _digestA),
          threadId: 'thread-1',
        ),
        isNull,
      );
      expect(
        pinned.refusal(
          nowMs: 31000,
          selectionRevision: 2,
          artifact: SendIntentArtifact(identity: _digestA),
          threadId: 'thread-1',
        ),
        SendIntentRefusal.expired,
      );
      expect(
        pinned.refusal(
          nowMs: 5000,
          selectionRevision: 3,
          artifact: SendIntentArtifact(identity: _digestA),
          threadId: 'thread-1',
        ),
        SendIntentRefusal.selectionChanged,
      );
      expect(
        pinned.refusal(
          nowMs: 5000,
          selectionRevision: 2,
          artifact: SendIntentArtifact(identity: _digestB),
          threadId: 'thread-1',
        ),
        SendIntentRefusal.artifactMismatch,
      );
      expect(
        pinned.refusal(
          nowMs: 5000,
          selectionRevision: 2,
          artifact: SendIntentArtifact(identity: _digestA),
          threadId: 'thread-2',
        ),
        SendIntentRefusal.threadChanged,
      );
    },
  );

  test(
    'held Send dispatches when a permitted computer arrives before TTL',
    () async {
      var next = 0;
      final network = MemoryNetwork(latency: _fast, chunkDelay: _fast);
      network.setComputers(const []);
      final (coordinator, session) = await _session('peer:a');
      final repository = SessionChatRepository(
        session: session,
        api: network.forIdentity(session.key.identity),
        newId: () => 'id-${++next}',
        sendIntentTtlMs: 500,
      );
      await repository.watchNetwork().firstWhere(
        (n) => n.status == NetworkStatus.online,
      );

      final id = repository.create();
      await repository.send(id, 'hello held', holdWhenUnavailable: true);

      final held = (await repository.watch(id).first).conversation!;
      expect(held.heldSend, isNotNull);
      expect(held.turns, isEmpty);
      expect(held.draft, 'hello held');
      expect(network.requests, 0);

      final modelId = network.catalog.first.id;
      network.setComputers([
        Computer(
          address: 'conn-1',
          modelId: modelId,
          ready: true,
          busy: false,
          participantId: 'peer:111111111111111111111111',
        ),
      ]);

      final completed = await repository
          .watch(id)
          .firstWhere(
            (r) =>
                r.conversation?.turns.lastOrNull?.phase == AnswerPhase.complete,
          );
      expect(completed.conversation!.heldSend, isNull);
      expect(completed.conversation!.draft, isEmpty);
      expect(network.requests, 1);
      await coordinator.dispose();
    },
  );

  test(
    'held Send expires after TTL without dispatching and keeps draft',
    () async {
      var next = 0;
      final network = MemoryNetwork(latency: _fast, chunkDelay: _fast);
      network.setComputers(const []);
      final (coordinator, session) = await _session('peer:a');
      final repository = SessionChatRepository(
        session: session,
        api: network.forIdentity(session.key.identity),
        newId: () => 'id-${++next}',
        sendIntentTtlMs: 40,
      );
      await repository.watchNetwork().firstWhere(
        (n) => n.status == NetworkStatus.online,
      );

      final id = repository.create();
      await repository.send(id, 'wait for it', holdWhenUnavailable: true);

      final expired = await repository
          .watch(id)
          .firstWhere(
            (r) =>
                r.conversation?.sendIntentRefusal == SendIntentRefusal.expired,
          );
      expect(expired.conversation!.heldSend, isNull);
      expect(expired.conversation!.turns, isEmpty);
      expect(expired.conversation!.draft, 'wait for it');
      expect(network.requests, 0);
      await coordinator.dispose();
    },
  );

  test(
    'pinned held Send refuses a different model and cancels on stop/dispose',
    () async {
      var next = 0;
      final network = MemoryNetwork(latency: _fast, chunkDelay: _fast);
      network.setComputers(const []);
      final (coordinator, session) = await _session('peer:a');
      final repository = SessionChatRepository(
        session: session,
        api: network.forIdentity(session.key.identity),
        newId: () => 'id-${++next}',
        sendIntentTtlMs: 500,
      );
      await repository.watchNetwork().firstWhere(
        (n) => n.status == NetworkStatus.online,
      );

      final id = repository.create();
      final pinnedModel = network.catalog.first;
      final otherModel = network.catalog[1];
      repository.selectModel(id, pinnedModel.id);
      await repository.send(id, 'pinned only', holdWhenUnavailable: true);

      // A different model arrives: pinned Send must NOT dispatch to it.
      network.setComputers([
        Computer(
          address: 'conn-other',
          modelId: otherModel.id,
          ready: true,
          busy: false,
          participantId: 'peer:222222222222222222222222',
        ),
      ]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      final stillHeld = (await repository.watch(id).first).conversation!;
      expect(stillHeld.heldSend, isNotNull);
      expect(stillHeld.turns, isEmpty);
      expect(network.requests, 0);

      // Stop cancels the held Send without dispatching.
      await repository.stop(id);
      final stopped = (await repository.watch(id).first).conversation!;
      expect(stopped.heldSend, isNull);
      expect(stopped.draft, 'pinned only');

      // Now the pinned model arrives after stop: must STILL not dispatch.
      network.setComputers([
        Computer(
          address: 'conn-pinned',
          modelId: pinnedModel.id,
          ready: true,
          busy: false,
          participantId: 'peer:333333333333333333333333',
        ),
      ]);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(network.requests, 0);
      await coordinator.dispose();
    },
  );
}
