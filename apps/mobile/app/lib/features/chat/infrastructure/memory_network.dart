import 'dart:async';

import 'package:core/core.dart';

import '../../../infrastructure/reploid_api/pairing.dart';
import '../domain/chat.dart';
import 'requester_api.dart';

enum AnswerBehavior { answer, decline, failMidStream, badReceipt }

enum PairingBehavior { approve, decline, silent, missing }

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

  /// The synthetic desktop a device can pair with through [pairingLink].
  static const desktopId = 'peer:0000000000000000000000d1';
  static const desktopLabel = 'Workbench';
  static const pairingLink =
      'https://replo.id/#pair=QEFCQ0RFRkdISUpLTE1OT1BR'
      '&host=peer%3A0000000000000000000000d1'
      '&room=reploid-swarm-demo&name=Workbench';
  bool desktopOnline = true;

  /// True once the desktop has dropped every phone it had paired.
  bool desktopForgot = false;
  final Set<SessionIdentity> _paired = {};
  PairingBehavior _nextPairing = PairingBehavior.approve;
  int pairingRequests = 0;

  void simulateNextPairing(PairingBehavior behavior) => _nextPairing = behavior;

  void setDesktopOnline(bool online) {
    desktopOnline = online;
    _changes.add(null);
  }

  /// Every prompt that left a device: (sender, recipient, last user text).
  final List<(SessionIdentity, String, String)> delivered = [];
  final List<String?> contextIds = [];
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
    desktop: network._paired.contains(identity)
        ? Desktop(
            participantId: MemoryNetwork.desktopId,
            label: MemoryNetwork.desktopLabel,
            status: _open && network.desktopOnline
                ? DesktopStatus.online
                : DesktopStatus.offline,
            modelId: MemoryNetwork.smallModel,
          )
        : null,
  );

  @override
  DesktopInvite? readInvite(String link) {
    final parsed = PairingLink.parse(link);
    return parsed == null
        ? null
        : DesktopInvite(
            participantId: parsed.hostParticipantId,
            label: parsed.hostLabel ?? parsed.hostParticipantId,
          );
  }

  @override
  Future<void> pair(String link, {void Function()? onAsked}) async {
    final parsed = PairingLink.parse(link);
    if (parsed == null) throw const AppFailure(FailureKind.validation);
    network.pairingRequests++;
    final behavior = network._nextPairing;
    network._nextPairing = PairingBehavior.approve;
    await Future<void>.delayed(network.latency);
    if (_closed) throw const AppFailure(FailureKind.sessionExpired);
    if (behavior == PairingBehavior.missing ||
        !network.desktopOnline ||
        parsed.hostParticipantId != MemoryNetwork.desktopId) {
      throw const AppFailure(FailureKind.unavailable);
    }
    onAsked?.call();
    await Future<void>.delayed(network.latency);
    if (_closed) throw const AppFailure(FailureKind.sessionExpired);
    switch (behavior) {
      case PairingBehavior.decline:
        throw const AppFailure(FailureKind.forbidden);
      case PairingBehavior.silent:
        throw const AppFailure(FailureKind.unavailable);
      default:
        network._paired.add(identity);
        network.desktopForgot = false;
        network._changes.add(null);
    }
  }

  @override
  Future<void> unpair() async {
    network._paired.remove(identity);
    network._changes.add(null);
  }

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
  Answer ask({
    required String modelId,
    required List<PromptMessage> messages,
    String? contextId,
    AnswerTarget target = AnswerTarget.contributors,
  }) {
    network.requests++;
    network.contextIds.add(contextId);
    final behavior = network._next;
    network._next = AnswerBehavior.answer;
    return _MemoryAnswer(this, modelId, messages, behavior, target);
  }
}

final class _MemoryAnswer implements Answer {
  _MemoryAnswer(
    this.api,
    this.modelId,
    this.messages,
    this.behavior,
    this.target,
  ) {
    _controller.onListen = () => unawaited(_run());
  }
  final _MemoryApi api;
  final String modelId;
  final List<PromptMessage> messages;
  final AnswerBehavior behavior;
  final AnswerTarget target;
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
      final Computer? computer;
      if (target == AnswerTarget.desktop) {
        // Only the paired desktop, and never a stand-in for it.
        final paired = network._paired.contains(api.identity);
        computer = paired && network.desktopOnline
            ? const Computer(
                address: 'memory-desktop',
                participantId: MemoryNetwork.desktopId,
                modelId: MemoryNetwork.smallModel,
                ready: true,
                busy: false,
              )
            : null;
      } else {
        computer = network.computers
            .where((c) => c.modelId == modelId && c.ready && !c.busy)
            .firstOrNull;
      }
      if (!api._open || computer == null) {
        throw const AppFailure(FailureKind.unavailable);
      }
      _controller.add(RecipientProven(computer.participantId!));
      await Future<void>.delayed(network.latency);
      if (_stopped) return;
      if (behavior == AnswerBehavior.decline ||
          (target == AnswerTarget.desktop && network.desktopForgot)) {
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
