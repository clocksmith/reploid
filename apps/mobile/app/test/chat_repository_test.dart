import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/chat_repository.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';

const _fast = Duration(milliseconds: 2);

Future<(SessionCoordinator, SessionHandle)> _session(String account) async {
  final coordinator = SessionCoordinator();
  await coordinator.activate(SessionIdentity(account));
  return (coordinator, coordinator.state.session!);
}

SessionChatRepository _repository(
  SessionHandle session,
  MemoryNetwork network, {
  Diagnostics diagnostics = const Diagnostics(),
}) {
  var next = 0;
  return SessionChatRepository(
    session: session,
    api: network.forIdentity(session.key.identity),
    newId: () => 'id-${next++}',
    diagnostics: diagnostics,
  );
}

Future<void> _online(SessionChatRepository repository) => repository
    .watchNetwork()
    .firstWhere((network) => network.status == NetworkStatus.online);

void main() {
  late MemoryNetwork network;
  setUp(() => network = MemoryNetwork(latency: _fast, chunkDelay: _fast));

  test('an answer names its recipient before the prompt leaves', () async {
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    final id = repository.create();
    final phases = <(AnswerPhase?, String?, bool)>[];
    final subscription = repository.watch(id).listen((resource) {
      final turns = resource.conversation?.turns ?? const <Turn>[];
      if (turns.length == 2) {
        phases.add((
          turns.last.phase,
          turns.last.recipient,
          turns.last.promptSent,
        ));
      }
    });
    await repository.send(id, 'hello there');
    await subscription.cancel();

    final proven = phases.indexWhere((p) => p.$2 != null);
    final sent = phases.indexWhere((p) => p.$3);
    expect(proven, greaterThanOrEqualTo(0));
    expect(sent, greaterThan(proven), reason: 'recipient is proven first');
    expect(phases.first, (AnswerPhase.finding, null, false));
    final last = await repository.watch(id).first;
    final answer = last.conversation!.turns.last;
    expect(answer.phase, AnswerPhase.complete);
    expect(answer.text, 'You asked: hello there');
    expect(answer.receiptVerified, isTrue);
    expect(answer.recipient, 'peer:00000000000000000000000a');
    expect(last.conversation!.title, 'hello there');
    expect(network.delivered.single.$3, 'hello there');
    await coordinator.dispose();
  });

  test('a busy computer is never chosen and counts as busy', () async {
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    final resource = await repository.watchNetwork().first;
    final model = resource.models.firstWhere(
      (m) => m.id == MemoryNetwork.smallModel,
    );
    expect((model.readyComputers, model.busyComputers), (1, 1));
    expect(
      resource.models
          .firstWhere((m) => m.id == MemoryNetwork.largeModel)
          .available,
      isFalse,
    );
    await coordinator.dispose();
  });

  test('a declined request fails with the prompt never sent', () async {
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    final id = repository.create();
    network.simulateNext(AnswerBehavior.decline);
    await repository.send(id, 'secret');
    final conversation = (await repository.watch(id).first).conversation!;
    final answer = conversation.turns.last;
    expect(answer.phase, AnswerPhase.failed);
    expect(answer.failure, FailureKind.forbidden);
    expect(answer.promptSent, isFalse);
    expect(answer.recipient, isNotNull);
    expect(network.delivered, isEmpty);
    expect(conversation.canRetry, isTrue);

    await repository.retry(id);
    final retried = (await repository.watch(id).first).conversation!;
    expect(retried.turns, hasLength(2));
    expect(retried.turns.last.phase, AnswerPhase.complete);
    expect(network.delivered.single.$3, 'secret');
    await coordinator.dispose();
  });

  test('a failure mid-stream keeps the partial answer', () async {
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    final id = repository.create();
    network.simulateNext(AnswerBehavior.failMidStream);
    await repository.send(id, 'one two three');
    final answer = (await repository.watch(id).first).conversation!.turns.last;
    expect(answer.phase, AnswerPhase.failed);
    expect(answer.failure, FailureKind.unavailable);
    expect(answer.promptSent, isTrue);
    expect(answer.text, 'You asked:');
    await coordinator.dispose();
  });

  test('an unverified receipt completes but is marked', () async {
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    final id = repository.create();
    network.simulateNext(AnswerBehavior.badReceipt);
    await repository.send(id, 'hi');
    final answer = (await repository.watch(id).first).conversation!.turns.last;
    expect(answer.phase, AnswerPhase.complete);
    expect(answer.receiptVerified, isFalse);
    await coordinator.dispose();
  });

  test('stop keeps received text and a second send never doubles', () async {
    network = MemoryNetwork(
      latency: _fast,
      chunkDelay: const Duration(milliseconds: 30),
    );
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    final id = repository.create();
    final first = repository.send(id, 'a b c d e f g h');
    final second = repository.send(id, 'a b c d e f g h');
    expect(identical(first, second), isTrue);
    await repository
        .watch(id)
        .firstWhere((r) => (r.conversation?.turns.last.text ?? '').isNotEmpty);
    await repository.stop(id);
    await first;
    final conversation = (await repository.watch(id).first).conversation!;
    expect(conversation.turns, hasLength(2));
    expect(conversation.turns.last.phase, AnswerPhase.stopped);
    expect(conversation.turns.last.failure, isNull);
    expect(conversation.turns.last.text, startsWith('You'));
    expect(network.requests, 1);
    expect(network.cancels, 1);
    await coordinator.dispose();
  });

  test('prompts are refused while network answers are off', () async {
    final (coordinator, session) = await _session('peer:a');
    final repository = _repository(session, network);
    await _online(repository);
    await repository.setNetworkAnswersAllowed(false);
    final id = repository.create();
    expect(
      () => repository.send(id, 'hello'),
      throwsA(
        isA<AppFailure>().having((f) => f.kind, 'kind', FailureKind.forbidden),
      ),
    );
    expect((await repository.watch(id).first).conversation!.turns, isEmpty);
    expect(network.requests, 0);
    await coordinator.dispose();
  });

  test(
    'no ready computer fails without a recipient or a sent prompt',
    () async {
      final (coordinator, session) = await _session('peer:a');
      final repository = _repository(session, network);
      await _online(repository);
      network.setComputers(const []);
      final id = repository.create();
      await repository.send(id, 'anyone?');
      final answer =
          (await repository.watch(id).first).conversation!.turns.last;
      expect(answer.phase, AnswerPhase.failed);
      expect(answer.failure, FailureKind.unavailable);
      expect((answer.recipient, answer.promptSent), (null, false));
      await coordinator.dispose();
    },
  );

  test('replacing the session stops old work and publishes nothing', () async {
    network = MemoryNetwork(
      latency: _fast,
      chunkDelay: const Duration(milliseconds: 30),
    );
    final coordinator = SessionCoordinator();
    await coordinator.activate(const SessionIdentity('peer:a'));
    final sessionA = coordinator.state.session!;
    final a = _repository(sessionA, network);
    await _online(a);
    final id = a.create();
    final seen = <ConversationResource>[];
    final subscription = a.watch(id).listen(seen.add);
    final sending = a.send(id, 'a b c d e f g h');
    await a
        .watch(id)
        .firstWhere((r) => r.conversation?.turns.last.promptSent ?? false);

    await coordinator.activate(const SessionIdentity('peer:b'));
    await sending;
    final framesAtSwitch = seen.length;
    await Future<void>.delayed(const Duration(milliseconds: 120));
    expect(seen.length, framesAtSwitch, reason: 'no late frame from A');
    expect(a.isClosed, isTrue);
    expect(a.subscriberCount, 0);
    expect(() => a.create(), throwsA(isA<AppFailure>()));

    final b = _repository(coordinator.state.session!, network);
    expect((await b.watchList().first).conversations, isEmpty);
    expect(network.delivered.map((d) => d.$1.accountId).toSet(), {'peer:a'});
    await subscription.cancel();
    await coordinator.dispose();
  });

  test('diagnostics carry no prompt, answer or identifier', () async {
    final events = <Map<String, Object>>[];
    final (coordinator, session) = await _session('peer:sentinel-account');
    final repository = _repository(
      session,
      network,
      diagnostics: Diagnostics(sink: events.add),
    );
    await _online(repository);
    final id = repository.create();
    await repository.send(id, 'SENTINEL-PROMPT');
    final dump = events.toString();
    expect(events, isNotEmpty);
    for (final secret in ['SENTINEL', 'peer:', 'id-', 'You asked']) {
      expect(dump.contains(secret), isFalse, reason: secret);
    }
    await coordinator.dispose();
  });
}
