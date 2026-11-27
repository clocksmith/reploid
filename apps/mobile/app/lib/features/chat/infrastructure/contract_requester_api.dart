import 'dart:async';

import 'package:core/core.dart';

import '../../../infrastructure/reploid_api/contract.g.dart';
import '../../../infrastructure/reploid_api/pairing.dart';
import '../../../infrastructure/reploid_api/peer_session.dart';
import '../../../infrastructure/reploid_api/requester_network.dart';
import '../../../infrastructure/reploid_api/requester_protocol.dart';
import '../domain/chat.dart';
import 'pairing_store.dart';
import 'requester_api.dart';

/// The chat feature's view of the real network: the contract engine's
/// events and failures mapped to domain values. No wire shape passes here.
///
/// Contributors are met in one room. A paired desktop offers itself in a
/// private room of its own, so that room is joined beside the first one for
/// as long as the pairing lasts.
final class ContractRequesterApi implements RequesterApi {
  ContractRequesterApi(
    this._network, {
    this.pairings,
    this.joinRoom,
    int Function()? now,
  }) : _now = now ?? (() => DateTime.now().millisecondsSinceEpoch);

  final RequesterNetwork _network;

  /// Where the paired desktop is kept between runs.
  final PairingStore? pairings;

  /// Joins a desktop's private room on the same signaling service.
  final RequesterNetwork Function(String roomId, String token)? joinRoom;
  final int Function() _now;
  final _changes = StreamController<void>.broadcast();
  final List<StreamSubscription<NetworkView>> _watching = [];
  PairingRecord? _record;
  RequesterNetwork? _room;
  DesktopStatus? _pairingStatus;
  DesktopInvite? _pairingInvite;
  bool _closed = false;

  @override
  List<CatalogModel> get catalog => [
    for (final row in modelCatalog)
      CatalogModel(id: row.id, name: row.name, identity: row.identity),
  ];

  /// The network the paired desktop is met on.
  RequesterNetwork get _desk => _room ?? _network;

  Desktop? _desktop() {
    final record = _record;
    if (record == null) {
      final invite = _pairingInvite;
      final status = _pairingStatus;
      return invite == null || status == null
          ? null
          : Desktop(
              participantId: invite.participantId,
              label: invite.label,
              status: status,
            );
    }
    // Online only while a connection has proven this exact identity.
    final session = _desk.proven(record.hostParticipantId);
    final advertisement = session?.advertisement;
    return Desktop(
      participantId: record.hostParticipantId,
      label: record.hostLabel,
      status: session == null ? DesktopStatus.offline : DesktopStatus.online,
      modelId: advertisement != null && advertisement.readiness == 'ready'
          ? advertisement.model
          : null,
    );
  }

  NetworkSnapshot _snapshot() {
    final view = _network.view;
    return NetworkSnapshot(
      status: switch (view.status) {
        TransportStatus.online => NetworkStatus.online,
        TransportStatus.connecting => NetworkStatus.connecting,
        TransportStatus.offline => NetworkStatus.offline,
      },
      computers: [
        for (final peer in view.peers)
          if (peer.advertisement case final advertisement?
              when advertisement.role == 'provider')
            Computer(
              address: peer.name,
              participantId: peer.participantId,
              modelId: advertisement.model ?? '',
              ready:
                  peer.usable &&
                  modelCatalog.any((row) => advertisement.readyFor(row)),
              busy: advertisement.busy,
            ),
      ],
      desktop: _desktop(),
    );
  }

  void _notify() {
    if (!_closed) _changes.add(null);
  }

  void _follow(RequesterNetwork network) =>
      _watching.add(network.watch().listen((_) => _notify()));

  @override
  Stream<NetworkSnapshot> watch() => Stream.multi((controller) {
    final subscription = _changes.stream.listen(
      (_) => controller.addSync(_snapshot()),
      onDone: controller.closeSync,
    );
    controller.addSync(_snapshot());
    controller.onCancel = subscription.cancel;
  });

  Future<void> _enter(String? roomId) async {
    if (roomId == null || joinRoom == null || _room != null) return;
    final room = _room = joinRoom!(roomId, pairingRoomToken(roomId));
    _follow(room);
    await room.open();
  }

  Future<void> _leaveRoom() async {
    final room = _room;
    _room = null;
    await room?.close();
  }

  bool _opened = false;

  @override
  Future<void> open() async {
    try {
      if (!_opened) {
        _opened = true;
        _follow(_network);
        _record = await pairings?.read();
        _notify();
      }
      await _network.open();
      // Back to the desktop's room on every start; a desktop that is not
      // there is simply offline.
      try {
        await _enter(_record?.roomId);
      } catch (_) {
        await _leaveRoom();
      }
    } on AppFailure {
      rethrow;
    } catch (error) {
      throw AppFailure(FailureKind.unavailable, cause: error);
    }
  }

  @override
  Future<void> close() async {
    _closed = true;
    for (final subscription in _watching) {
      await subscription.cancel();
    }
    await _leaveRoom();
    await _network.close();
    await _changes.close();
  }

  // Owner pairing ---------------------------------------------------------

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
    if (_pairingStatus != null) throw const AppFailure(FailureKind.conflict);
    final previous = _record;
    _record = null;
    await _leaveRoom();
    _pairingInvite = readInvite(link);
    _pairingStatus = DesktopStatus.finding;
    _notify();
    var approved = false;
    try {
      await _enter(parsed.roomId);
      approved = await _desk.pair(
        code: parsed.code,
        hostParticipantId: parsed.hostParticipantId,
        onAsked: () {
          _pairingStatus = DesktopStatus.awaitingApproval;
          _notify();
          onAsked?.call();
        },
      );
      if (!approved) throw const AppFailure(FailureKind.forbidden);
      final record = PairingRecord(
        hostParticipantId: parsed.hostParticipantId,
        hostLabel: parsed.hostLabel ?? parsed.hostParticipantId,
        roomId: parsed.roomId,
        pairedAt: _now(),
      );
      await pairings?.write(record);
      _record = record;
    } on ProtocolFailure catch (failure) {
      throw _failure(failure);
    } catch (error) {
      if (error is AppFailure) rethrow;
      throw AppFailure(FailureKind.unavailable, cause: error);
    } finally {
      _pairingStatus = null;
      _pairingInvite = null;
      if (!approved) {
        // An earlier pairing is not lost to a failed attempt at a new one.
        await _leaveRoom();
        _record = previous;
        try {
          await _enter(previous?.roomId);
        } catch (_) {
          await _leaveRoom();
        }
      }
      _notify();
    }
  }

  /// Procedure `pairingForget`: the record is deleted and nothing is sent.
  @override
  Future<void> unpair() async {
    _record = null;
    await pairings?.delete();
    await _leaveRoom();
    _notify();
  }

  // Requests ------------------------------------------------------------------

  static List<Json> _messages(List<PromptMessage> messages) => [
    for (final message in messages)
      {
        'role': switch (message.role) {
          TurnRole.user => 'user',
          TurnRole.assistant => 'assistant',
        },
        'content': message.text,
      },
  ];

  @override
  Answer ask({
    required String modelId,
    required List<PromptMessage> messages,
    String? contextId,
    AnswerTarget target = AnswerTarget.contributors,
    String? expectedRecipient,
  }) {
    if (target == AnswerTarget.desktop) {
      final record = _record;
      if (record == null) {
        return _ContractAnswer(
          Stream.error(const AppFailure(FailureKind.validation)),
        );
      }
      // The model is whichever one the desktop is ready with. Until it is
      // online nothing is sent; the engine waits, then fails.
      final ready = _desktop()?.modelId;
      final row =
          modelCatalog.where((row) => row.id == ready).firstOrNull ??
          modelCatalog.where((row) => row.id == modelId).firstOrNull ??
          modelCatalog.first;
      return _ContractAnswer(
        _desk
            .ask(
              model: row,
              messages: _messages(messages),
              contextId: contextId,
              namedRecipient: record.hostParticipantId,
            )
            .transform(_events),
      );
    }
    final row = modelCatalog.where((row) => row.id == modelId).firstOrNull;
    return _ContractAnswer(
      row == null
          ? Stream.error(const AppFailure(FailureKind.validation))
          : _network
                .ask(
                  model: row,
                  messages: _messages(messages),
                  contextId: contextId,
                  expectedRecipient: expectedRecipient,
                )
                .transform(_events),
    );
  }

  @override
  void setBlocked(Set<String> ids) {
    _network.blocked = Set.unmodifiable(ids);
    _notify();
  }

  @override
  String? nextRecipient({required String modelId, String? contextId}) {
    final row = modelCatalog.where((row) => row.id == modelId).firstOrNull;
    return row == null ? null : _network.nextRecipient(row, contextId);
  }

  static final _events =
      StreamTransformer<GenerationEvent, AnswerEvent>.fromHandlers(
        handleData: (event, sink) => sink.add(switch (event) {
          ProviderProven(:final participantId) => RecipientProven(
            participantId,
          ),
          PromptDispatched(:final requestId, :final modelId) => PromptSent(
            requestId: requestId,
            modelId: modelId,
          ),
          TextChunk(:final text) => AnswerChunk(text),
          GenerationCompleted(:final content) => AnswerCompleted(
            content,
            receiptVerified: true,
          ),
        }),
        handleError: (error, stack, sink) {
          if (error is ProtocolFailure &&
              error.promptSent &&
              _lost.contains(error.message)) {
            sink.add(const AnswerLost());
          }
          sink.addError(_failure(error), stack);
        },
      );

  /// The result may exist on the other computer; these did not say it failed.
  static const _lost = {
    'Execution peer disconnected; retry requires a new attempt',
    'Remote generation timed out',
  };

  @override
  Future<RecoveredAnswer> recover({
    required String requestId,
    required String modelId,
    required List<PromptMessage> messages,
    required String recipient,
  }) async {
    final row = modelCatalog.where((row) => row.id == modelId).firstOrNull;
    if (row == null) throw const AppFailure(FailureKind.validation);
    final network = _desk.proven(recipient) != null ? _desk : _network;
    try {
      return switch (await network.recover(
        requestId: requestId,
        model: row,
        messages: _messages(messages),
        providerParticipantId: recipient,
      )) {
        RecoveryAnswered(:final content) => RecoveredAnswer(
          RecoverResult.answered,
          text: content,
        ),
        RecoveryEnded() => const RecoveredAnswer(RecoverResult.ended),
        RecoveryUnresolved() => const RecoveredAnswer(RecoverResult.notYet),
      };
    } on ProtocolFailure {
      return const RecoveredAnswer(RecoverResult.notYet);
    }
  }

  /// The other computer's words never become user-facing copy; only the
  /// category crosses this boundary.
  static AppFailure _failure(Object error) {
    if (error is AppFailure) return error;
    if (error is! ProtocolFailure) {
      return AppFailure(FailureKind.unexpected, cause: error);
    }
    final message = error.message;
    final kind = error.declined
        ? FailureKind.forbidden
        : message.startsWith('Conversation exceeds')
        ? FailureKind.validation
        : _untrusted.any(message.startsWith)
        ? FailureKind.unauthenticated
        : FailureKind.unavailable;
    return AppFailure(kind, cause: error);
  }

  static const _untrusted = [
    'Recipient signing identity mismatch',
    'Invalid recipient identity proof',
    'Recipient connection changed',
    'Could not verify the paired desktop',
    'Desktop connection changed',
    'Remote response substituted',
    'Remote receipt is invalid',
    'Measured receipt differs',
    'Provider input token count differs',
    'Receipt does not bind',
    'A version 2 receipt is required',
    'The provider admitted a different request',
  ];
}

final class _ContractAnswer implements Answer {
  _ContractAnswer(Stream<AnswerEvent> source) {
    _controller = StreamController<AnswerEvent>(
      onListen: () => _subscription = source.listen(
        _controller.add,
        onError: _controller.addError,
        onDone: _controller.close,
      ),
      onCancel: () => _subscription?.cancel(),
    );
  }
  late final StreamController<AnswerEvent> _controller;
  StreamSubscription<AnswerEvent>? _subscription;

  @override
  Stream<AnswerEvent> get events => _controller.stream;

  /// Cancelling the engine's stream sends the contract's cancel frame.
  @override
  Future<void> cancel() async {
    await _subscription?.cancel();
    if (!_controller.isClosed) await _controller.close();
  }
}
