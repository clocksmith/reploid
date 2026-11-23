/// The requester side of one connection: envelopes, keep-alive, identity
/// challenges in both directions, the peer's advertisement, and whole-model
/// requests (contract `sequence`, steps 7 to 15).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'canonical_json.dart';
import 'codec.dart';
import 'contract.g.dart';
import 'identity.dart';
import 'peer_link.dart';
import 'requester_protocol.dart';

/// Procedure `lamportTimestamp`: one clock for all connections of a client.
final class LamportClock {
  int _value = 0;
  int next() => ++_value;
  void observe(num seen) => _value = max(_value, seen.toInt()) + 1;
}

/// Where the protocol's fresh values come from; tests replace it.
abstract interface class Entropy {
  factory Entropy([Random? random]) = _RandomEntropy;
  String uuid();

  /// Procedure `promptCommitment`: 32 fresh bytes as 64 hex digits.
  String salt();
}

final class _RandomEntropy implements Entropy {
  _RandomEntropy([Random? random]) : _random = random ?? Random.secure();
  final Random _random;

  @override
  String uuid() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final text = hex(bytes);
    return '${text.substring(0, 8)}-${text.substring(8, 12)}-'
        '${text.substring(12, 16)}-${text.substring(16, 20)}-'
        '${text.substring(20)}';
  }

  @override
  String salt() => hex(List<int>.generate(32, (_) => _random.nextInt(256)));
}

sealed class GenerationEvent {
  const GenerationEvent();
}

/// The provider proved its signing identity on this connection.
final class ProviderProven extends GenerationEvent {
  const ProviderProven(this.participantId);
  final String participantId;
}

/// `reploid:generation-request` was sent: the provider now has the prompt.
final class PromptDispatched extends GenerationEvent {
  const PromptDispatched();
}

final class TextChunk extends GenerationEvent {
  const TextChunk(this.text);
  final String text;
}

/// The result verified against its signed receipt, which was countersigned
/// and returned to the provider.
final class GenerationCompleted extends GenerationEvent {
  const GenerationCompleted(this.content, this.receipt);
  final String content;
  final Json receipt;
}

final class _Waiter {
  _Waiter(this.match);
  final Object? Function(String type, Json payload) match;
  final completer = Completer<Json>();
}

final class PeerSession {
  PeerSession({
    required this.link,
    required this.identity,
    required this.clock,
    Entropy? entropy,
    int Function()? now,
    this.timeout = const Duration(milliseconds: Contract.generationTimeoutMs),
    this.onChanged,
  }) : entropy = entropy ?? Entropy(),
       now = now ?? (() => DateTime.now().millisecondsSinceEpoch) {
    _subscription = link.texts.listen(_receive, onDone: _closed);
    unawaited(link.closed.then((_) => _closed()));
    _send(ChannelType.syncRequest, {});
  }

  final PeerLink link;
  final SigningIdentity identity;
  final LamportClock clock;
  final Entropy entropy;
  final int Function() now;
  final Duration timeout;

  /// Called when the advertisement or the proven identity changes.
  final void Function()? onChanged;

  late final StreamSubscription<String> _subscription;
  final List<_Waiter> _waiters = [];
  final Set<String> _signing = {};
  Advertisement? _advertisement;
  String? _proven;
  bool _reserved = false;
  bool _isClosed = false;

  Advertisement? get advertisement => _isClosed ? null : _advertisement;

  /// The identity this peer last proved on this connection, if any.
  String? get provenParticipantId => _proven;
  bool get reserved => _reserved;
  bool get isClosed => _isClosed;

  /// Procedure `readyPeerRule`: can this connection carry a request now.
  bool get usable => !_isClosed && link.isOpen && link.binding != null;

  // Envelopes -------------------------------------------------------------

  /// Procedure `envelopeValidation`, sending side.
  void _send(String type, Json payload) {
    final text = jsJson(payload);
    if (text.length > Contract.rtcMaxPayloadSize) {
      throw const ProtocolFailure(
        'Conversation exceeds transport payload limit',
      );
    }
    link.send(
      jsJson({
        'protocolVersion': Contract.rtcEnvelopeProtocolVersion,
        'type': type,
        'peerId': link.selfId,
        'timestamp': clock.next(),
        'payload': payload,
        'payloadSize': text.length,
      }),
    );
  }

  /// Procedure `envelopeValidation`, receiving side. A rejected frame is
  /// dropped silently and the connection stays open.
  void _receive(String text) {
    if (_isClosed) return;
    final envelope = acceptEnvelope(text, from: link.peerId);
    if (envelope == null) return;
    final type = envelope['type']! as String;
    final timestamp = envelope['timestamp']! as num;
    clock.observe(timestamp);
    final raw = envelope['payload'];
    final payload = raw is Map<String, Object?> ? raw : <String, Object?>{};
    switch (type) {
      case ChannelType.ping:
        _trySend(ChannelType.pong, {'ts': payload['ts'], 'received': now()});
        return;
      case ChannelType.identityChallenge:
        unawaited(_answerChallenge(payload));
        return;
      case ChannelType.peerAdvertisement:
        final accepted = Advertisement.accept(payload);
        if (accepted != null) {
          _advertisement = accepted;
          onChanged?.call();
        }
    }
    for (final waiter in List.of(_waiters)) {
      final Object? outcome;
      try {
        outcome = waiter.match(type, payload);
      } on ProtocolFailure catch (failure) {
        _waiters.remove(waiter);
        waiter.completer.completeError(failure);
        continue;
      }
      if (outcome == null) continue;
      _waiters.remove(waiter);
      waiter.completer.complete(outcome as Json);
    }
    // Every other known type is ignored, as the contract requires.
  }

  void _trySend(String type, Json payload) {
    try {
      _send(type, payload);
    } on StateError {
      // The link closed under us; its pending requests fail through _closed.
    }
  }

  Future<Json> _expect(
    Object? Function(String type, Json payload) match, {
    required String onTimeout,
  }) {
    final waiter = _Waiter(match);
    _waiters.add(waiter);
    return waiter.completer.future.timeout(
      timeout,
      onTimeout: () {
        _waiters.remove(waiter);
        throw ProtocolFailure(onTimeout);
      },
    );
  }

  void _closed() {
    if (_isClosed) return;
    _isClosed = true;
    _advertisement = null;
    _proven = null;
    unawaited(_subscription.cancel());
    for (final waiter in List.of(_waiters)) {
      waiter.completer.completeError(
        const ProtocolFailure(
          'Execution peer disconnected; retry requires a new attempt',
        ),
      );
    }
    _waiters.clear();
    onChanged?.call();
  }

  // Identity ----------------------------------------------------------------

  /// Procedure `identityChallengeAnswer`. A refused challenge gets no reply.
  Future<void> _answerChallenge(Json challenge) async {
    final binding = link.binding;
    final nonceText = challenge['nonce'];
    if (binding == null ||
        challenge['roomId'] != link.roomId ||
        challenge['requester'] != link.peerId ||
        challenge['provider'] != link.selfId ||
        nonceText is! String ||
        !nonce.hasMatch(nonceText) ||
        challenge['local'] != binding.remote ||
        challenge['remote'] != binding.local ||
        !_signing.add(nonceText)) {
      return;
    }
    try {
      final signature = await identity.sign(
        utf8Bytes(identityProofText(challenge, identity.peerId)),
      );
      if (_isClosed || link.binding != binding) return;
      _trySend(ChannelType.identityProof, {
        'nonce': nonceText,
        'participantId': identity.peerId,
        'publicJwk': identity.publicJwk,
        'signature': toBase64Url(signature),
      });
    } finally {
      _signing.remove(nonceText);
    }
  }

  /// Procedure `identityProofVerification`, with a fresh challenge.
  Future<String> proveProvider() async {
    final binding = link.binding;
    if (binding == null || !usable) {
      throw const ProtocolFailure('No remote host slot available');
    }
    final challenge = <String, Object?>{
      'roomId': link.roomId,
      'nonce': entropy.uuid(),
      'requester': link.selfId,
      'provider': link.peerId,
      'local': binding.local,
      'remote': binding.remote,
    };
    final answered = _expect(
      (type, payload) =>
          type == ChannelType.identityProof &&
              payload['nonce'] == challenge['nonce']
          ? payload
          : null,
      onTimeout: 'Recipient identity proof timed out',
    );
    _send(ChannelType.identityChallenge, challenge);
    final participantId = await verifyIdentityProof(challenge, await answered);
    if (_isClosed || link.binding != binding) {
      throw const ProtocolFailure(
        'Recipient connection changed during verification',
      );
    }
    if (_proven != participantId) {
      _proven = participantId;
      onChanged?.call();
    }
    return participantId;
  }

  // Owner pairing ---------------------------------------------------------------

  /// Procedure `pairingExchange`, steps 5 to 9, on this connection. Returns
  /// whether the owner approved. The code leaves the device only after
  /// this connection has freshly proven it is [hostParticipantId].
  ///
  /// A wrong, expired or used code gets no answer at all, so that case
  /// ends as a timeout after [wait].
  Future<bool> requestPairing({
    required String code,
    required String hostParticipantId,
    Duration wait = const Duration(
      milliseconds: Contract.pairingApprovalWaitMs,
    ),
    void Function()? onSent,
  }) async {
    if (await proveProvider() != hostParticipantId) {
      throw const ProtocolFailure('Could not verify the paired desktop');
    }
    final binding = link.binding;
    final requestId = entropy.uuid();
    final waiter = _Waiter(
      (type, payload) =>
          type == ChannelType.ownerPairingResult &&
              payload['requestId'] == requestId
          ? payload
          : null,
    );
    _waiters.add(waiter);
    _send(ChannelType.ownerPairingRequest, {
      'requestId': requestId,
      'code': code,
    });
    onSent?.call();
    final Json result;
    try {
      result = await waiter.completer.future.timeout(wait);
    } on TimeoutException {
      _waiters.remove(waiter);
      throw const ProtocolFailure('The desktop did not answer the pairing');
    }
    if (_isClosed || link.binding != binding || _proven != hostParticipantId) {
      throw const ProtocolFailure('Desktop connection changed during pairing');
    }
    return result['approved'] == true;
  }

  // Generation ----------------------------------------------------------------

  /// One whole-model request. The stream ends after [GenerationCompleted]
  /// or with a [ProtocolFailure] that says whether the prompt was sent.
  /// Cancelling the subscription sends `reploid:generation-cancel`.
  ///
  /// With [namedRecipient] the request goes only to that signing identity:
  /// if the fresh proof names anyone else, nothing is sent. With
  /// [expectedRecipient] the wire policy stays open, but the prompt is sent
  /// only if the fresh proof names the computer the person was shown.
  Stream<GenerationEvent> ask({
    required CatalogRow model,
    required List<Json> messages,
    String? contextId,
    String? namedRecipient,
    String? expectedRecipient,
  }) {
    late final StreamController<GenerationEvent> controller;
    String? requestId;
    var sent = false, done = false;

    Future<void> run() async {
      _reserved = true;
      try {
        final before = _advertisement;
        if (before == null || !usable || !before.selectable(model)) {
          throw const ProtocolFailure('No remote host slot available');
        }
        final proven = await proveProvider();
        if (done) return;
        if (namedRecipient != null && proven != namedRecipient) {
          throw const ProtocolFailure('Could not verify the paired desktop');
        }
        // The person was told this computer would read the prompt.
        if (expectedRecipient != null && proven != expectedRecipient) {
          throw const ProtocolFailure(
            'Selected contributor is no longer ready; '
            'retry requires new placement',
          );
        }
        controller.add(ProviderProven(proven));
        final offer = before.eligibleOffers(model.identity).firstOrNull;
        if (offer == null) {
          throw const ProtocolFailure(
            'Selected execution offer is unavailable',
          );
        }
        final policy = privacyPolicy(namedRecipient: namedRecipient);
        final binding = privacyBinding(
          policy,
          executionRoute(
            modelId: model.id,
            modelIdentity: model.identity,
            providerId: proven,
            offer: offer,
          ),
        );
        final id = requestId = entropy.uuid();
        final salt = entropy.salt();
        final request = <String, Object?>{
          'requestId': id,
          'consumer': identity.peerId,
          'provider': link.peerId,
          'contextId': ?contextId,
          'model': model.id,
          'modelIdentity': model.identity,
          'adapterIdentities': <Object?>[],
          'modelContract': null,
          'admissionProtocol': Contract.generationAdmissionProtocol,
          'privacy': policy,
          'privacyBinding': binding,
          'offerId': offer['id'],
          'messages': messages,
          'recoverable': true,
          'admission': {'salt': salt},
        };
        if (utf8.encode(jsJson(request)).length > Contract.rtcMaxPayloadSize) {
          throw const ProtocolFailure(
            'Conversation exceeds transport payload limit',
          );
        }
        final commitment = promptCommitment(salt, messages);

        Object? failure(String type, Json payload) {
          if (type != ChannelType.generationError ||
              payload['requestId'] != id) {
            return null;
          }
          final text = payload['error'];
          final message = text is String ? text : 'Remote generation failed';
          throw ProtocolFailure(
            message,
            declined: message.startsWith('The provider declined'),
            code: payload['code'] is String ? payload['code']! as String : null,
          );
        }

        void requireStillReady() {
          final current = _advertisement;
          if (!usable ||
              current == null ||
              !current.selectable(model) ||
              current.placementKey != before.placementKey ||
              _proven != proven) {
            throw const ProtocolFailure(
              'Selected contributor is no longer ready; '
              'retry requires new placement',
            );
          }
        }

        requireStillReady();
        final admitted = _expect(
          (type, payload) =>
              failure(type, payload) ??
              (type == ChannelType.generationAdmitted &&
                      payload['requestId'] == id
                  ? payload
                  : null),
          onTimeout: 'Remote generation timed out',
        );
        _send(ChannelType.generationAdmit, admitPayload(request, commitment));
        final admission = await admitted;
        if (done) return;
        if (admission['admissionProtocol'] !=
                Contract.generationAdmissionProtocol ||
            admission['promptCommitment'] != commitment) {
          _trySend(ChannelType.generationCancel, {'requestId': id});
          throw const ProtocolFailure(
            'The provider admitted a different request. '
            'The prompt was not sent.',
          );
        }
        try {
          requireStillReady();
        } on ProtocolFailure {
          _trySend(ChannelType.generationCancel, {'requestId': id});
          rethrow;
        }

        final chunks = StringBuffer();
        int? earlyInputTokens;
        final finished = _expect((type, payload) {
          if (payload['requestId'] != id) return null;
          if (type == ChannelType.generationUpdate) {
            final chunk = payload['chunk'];
            if (chunk is String && chunk.isNotEmpty) {
              chunks.write(chunk);
              if (!done) controller.add(TextChunk(chunk));
            } else if (chunks.isEmpty && earlyInputTokens == null) {
              final usage = payload['usage'];
              final count = usage is Map ? usage['inputTokens'] : null;
              if (count is num && isCount(count) && count > 0) {
                earlyInputTokens = count.toInt();
              }
            }
            return null;
          }
          return failure(type, payload) ??
              (type == ChannelType.generationResult ? payload : null);
        }, onTimeout: 'Remote generation timed out');
        _send(ChannelType.generationRequest, request);
        sent = true;
        controller.add(const PromptDispatched());
        final Json result;
        try {
          result = await finished;
        } on ProtocolFailure catch (failure) {
          if (failure.message == 'Remote generation timed out') {
            _trySend(ChannelType.generationCancel, {'requestId': id});
          }
          rethrow;
        }
        if (done) return;
        final receipt = result['receipt'];
        final payload = await verifyResult(
          requestId: id,
          modelId: model.id,
          modelIdentity: model.identity,
          messages: messages,
          provenProvider: proven,
          ownParticipantId: identity.peerId,
          earlyInputTokens: earlyInputTokens,
          response: result['response'],
          receipt: receipt,
        );
        final countersigned = await countersign(
          payload,
          receipt! as Json,
          identity,
        );
        _trySend(ChannelType.receipt, {'receipt': countersigned});
        if (done) return;
        final response = result['response']! as Json;
        controller.add(
          GenerationCompleted(response['content']! as String, countersigned),
        );
      } on ProtocolFailure catch (failure, stack) {
        if (!done) controller.addError(sent ? failure.sent() : failure, stack);
      } on StateError catch (_, stack) {
        if (!done) {
          controller.addError(
            ProtocolFailure(
              'Execution peer disconnected; retry requires a new attempt',
              promptSent: sent,
            ),
            stack,
          );
        }
      } finally {
        _reserved = false;
        done = true;
        await controller.close();
      }
    }

    controller = StreamController<GenerationEvent>(
      onListen: () => unawaited(run()),
      onCancel: () {
        if (done) return;
        done = true;
        final id = requestId;
        if (id != null) {
          _trySend(ChannelType.generationCancel, {'requestId': id});
        }
      },
    );
    return controller.stream;
  }

  Future<void> close() async => _closed();
}
