import 'dart:async';

import 'package:core/core.dart';

import '../domain/chat.dart';
import 'requester_api.dart';

enum AnswerBehavior { answer, decline, failMidStream, badReceipt }

/// A synthetic network for tests and the demo build. It outlives sessions,
/// as the real network does, and records which identity sent what to whom so
/// tests can assert that nothing crosses a session boundary.
///
/// It performs no cryptography and proves nothing about real computers.
final class MemoryNetwork {
  MemoryNetwork({
    this.latency = const Duration(milliseconds: 250),
    this.chunkDelay = const Duration(milliseconds: 60),
  });

  final Duration latency;
  final Duration chunkDelay;

  static const smallModel = 'qwen-3-5-2b-q4k-ef16-af32';
  static const largeModel = 'qwen-3-8-27b-text-q4k-ef16-af32';

  final List<CatalogModel> catalog = const [
    CatalogModel(id: smallModel, name: 'Qwen 3.5 2B'),
    CatalogModel(id: largeModel, name: 'Qwen 3.8 27B'),
  ];

  List<Computer> computers = const [
    Computer(
      address: 'memory-a',
      participantId: 'peer:00000000000000000000000a',
      modelId: smallModel,
      ready: true,
      busy: false,
    ),
    Computer(
      address: 'memory-b',
      participantId: 'peer:00000000000000000000000b',
      modelId: smallModel,
      ready: true,
      busy: true,
    ),
  ];

  /// Every prompt that left a device: (sender, recipient, last user text).
  final List<(SessionIdentity, String, String)> delivered = [];
  int requests = 0;
  int cancels = 0;
  AnswerBehavior _next = AnswerBehavior.answer;
  final _changes = StreamController<void>.broadcast();

  void simulateNext(AnswerBehavior behavior) => _next = behavior;

  void setComputers(List<Computer> next) {
    computers = List.unmodifiable(next);
    _changes.add(null);
  }

  RequesterApi forIdentity(SessionIdentity identity) =>
      _MemoryApi(this, identity);
}

final class _MemoryApi implements RequesterApi {
  _MemoryApi(this.network, this.identity);
  final MemoryNetwork network;
  final SessionIdentity identity;
  bool _open = false;
  bool _closed = false;
  final _status = StreamController<void>.broadcast();

  @override
  List<CatalogModel> get catalog => network.catalog;

  NetworkSnapshot _snapshot() => NetworkSnapshot(
    status: _open ? NetworkStatus.online : NetworkStatus.offline,
    computers: _open ? network.computers : const [],
  );

  @override
  Stream<NetworkSnapshot> watch() => Stream.multi((controller) {
    final subscriptions = [
      network._changes.stream.listen((_) => controller.addSync(_snapshot())),
      _status.stream.listen((_) => controller.addSync(_snapshot())),
    ];
    controller.addSync(_snapshot());
    controller.onCancel = () async {
      for (final subscription in subscriptions) {
        await subscription.cancel();
      }
    };
  });

  @override
  Future<void> open() async {
    if (_closed) throw const AppFailure(FailureKind.sessionExpired);
    await Future<void>.delayed(network.latency);
    if (_closed) return;
    _open = true;
    _status.add(null);
  }

  @override
  Future<void> close() async {
    _closed = true;
    _open = false;
    await _status.close();
  }

  @override
  Answer ask({required String modelId, required List<PromptMessage> messages}) {
    network.requests++;
    final behavior = network._next;
    network._next = AnswerBehavior.answer;
    return _MemoryAnswer(this, modelId, messages, behavior);
  }
}

final class _MemoryAnswer implements Answer {
  _MemoryAnswer(this.api, this.modelId, this.messages, this.behavior) {
    _controller.onListen = () => unawaited(_run());
  }
  final _MemoryApi api;
  final String modelId;
  final List<PromptMessage> messages;
  final AnswerBehavior behavior;
  final _controller = StreamController<AnswerEvent>();
  bool _cancelled = false;

  @override
  Stream<AnswerEvent> get events => _controller.stream;

  bool get _stopped => _cancelled || api._closed;

  Future<void> _run() async {
    final network = api.network;
    try {
      await Future<void>.delayed(network.latency);
      if (_stopped) return;
      final computer = network.computers
          .where((c) => c.modelId == modelId && c.ready && !c.busy)
          .firstOrNull;
      if (!api._open || computer == null) {
        throw const AppFailure(FailureKind.unavailable);
      }
      _controller.add(RecipientProven(computer.participantId!));
      await Future<void>.delayed(network.latency);
      if (_stopped) return;
      if (behavior == AnswerBehavior.decline) {
        throw const AppFailure(FailureKind.forbidden);
      }
      final prompt = messages.last.text;
      network.delivered.add((api.identity, computer.participantId!, prompt));
      _controller.add(const PromptSent());
      final words = 'You asked: $prompt'.split(' ');
      final text = StringBuffer();
      for (var i = 0; i < words.length; i++) {
        await Future<void>.delayed(network.chunkDelay);
        if (_stopped) return;
        if (behavior == AnswerBehavior.failMidStream && i == 2) {
          throw const AppFailure(FailureKind.unavailable);
        }
        final chunk = i == 0 ? words[i] : ' ${words[i]}';
        text.write(chunk);
        _controller.add(AnswerChunk(chunk));
      }
      _controller.add(
        AnswerCompleted(
          text.toString(),
          receiptVerified: behavior != AnswerBehavior.badReceipt,
        ),
      );
    } on AppFailure catch (failure, stack) {
      if (!_stopped) _controller.addError(failure, stack);
    } finally {
      await _controller.close();
    }
  }

  @override
  Future<void> cancel() async {
    if (_cancelled) return;
    _cancelled = true;
    api.network.cancels++;
  }
}
