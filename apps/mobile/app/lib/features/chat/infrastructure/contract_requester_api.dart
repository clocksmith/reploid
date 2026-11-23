import 'dart:async';

import 'package:core/core.dart';

import '../../../infrastructure/reploid_api/contract.g.dart';
import '../../../infrastructure/reploid_api/peer_session.dart';
import '../../../infrastructure/reploid_api/requester_network.dart';
import '../../../infrastructure/reploid_api/requester_protocol.dart';
import '../domain/chat.dart';
import 'requester_api.dart';

/// The chat feature's view of the real network: the contract engine's
/// events and failures mapped to domain values. No wire shape passes here.
final class ContractRequesterApi implements RequesterApi {
  ContractRequesterApi(this._network);
  final RequesterNetwork _network;

  @override
  List<CatalogModel> get catalog => [
    for (final row in modelCatalog) CatalogModel(id: row.id, name: row.name),
  ];

  NetworkSnapshot _map(NetworkView view) => NetworkSnapshot(
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
  );

  @override
  Stream<NetworkSnapshot> watch() => _network.watch().map(_map);

  @override
  Future<void> open() async {
    try {
      await _network.open();
    } on AppFailure {
      rethrow;
    } catch (error) {
      throw AppFailure(FailureKind.unavailable, cause: error);
    }
  }

  @override
  Future<void> close() => _network.close();

  @override
  Answer ask({required String modelId, required List<PromptMessage> messages}) {
    final row = modelCatalog.where((row) => row.id == modelId).firstOrNull;
    return _ContractAnswer(
      row == null
          ? Stream.error(const AppFailure(FailureKind.validation))
          : _network
                .ask(
                  model: row,
                  messages: [
                    for (final message in messages)
                      {
                        'role': switch (message.role) {
                          TurnRole.user => 'user',
                          TurnRole.assistant => 'assistant',
                        },
                        'content': message.text,
                      },
                  ],
                )
                .transform(_events),
    );
  }

  static final _events =
      StreamTransformer<GenerationEvent, AnswerEvent>.fromHandlers(
        handleData: (event, sink) => sink.add(switch (event) {
          ProviderProven(:final participantId) => RecipientProven(
            participantId,
          ),
          PromptDispatched() => const PromptSent(),
          TextChunk(:final text) => AnswerChunk(text),
          GenerationCompleted(:final content) => AnswerCompleted(
            content,
            receiptVerified: true,
          ),
        }),
        handleError: (error, stack, sink) =>
            sink.addError(_failure(error), stack),
      );

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
