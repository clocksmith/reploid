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
  const PromptDispatched(this.requestId, this.modelId);

  /// What procedure `recovery` needs if the result never arrives.
  final String requestId;
  final String modelId;
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

/// What became of a request whose result did not arrive (procedure
/// `recovery`). Asking never runs the request again.
sealed class RecoveryOutcome {
  const RecoveryOutcome();
}

/// Unknown, still running, or no longer kept: ask again later.
final class RecoveryUnresolved extends RecoveryOutcome {
  const RecoveryUnresolved();
}

/// The provider signed that the request ended without an answer.
final class RecoveryEnded extends RecoveryOutcome {
  const RecoveryEnded(this.status);
  final String status;
}

/// The answer, verified against its signed receipt and countersigned.
final class RecoveryAnswered extends RecoveryOutcome {
  const RecoveryAnswered(this.content, this.receipt);
  final String content;
  final Json receipt;
}

/// Procedure `requestDelivery`, protocol 1, for one request: each stage
/// sent and not yet acknowledged is sent again on the same connection after
/// the acknowledgement timeout, at most maxRequestResends times. It never
/// chooses another recipient.
final class _Delivery {
  _Delivery({required this.protocol, required this.ackTimeout});

  final int protocol;
  final Duration ackTimeout;
  final Map<String, Timer?> _timers = {};
  final Set<String> _acknowledged = {};
  bool _stopped = false;

  void sent(String stage, bool Function(int attempt) resend) {
    if (_stopped || _timers.containsKey(stage)) return;
    var attempt = 1;
    void arm() {
      _timers[stage] = Timer(ackTimeout, () {
        if (_stopped ||
            _acknowledged.contains(stage) ||
            attempt > Contract.generationMaxRequestResends) {
          return;
        }
        attempt++;
        if (resend(attempt)) arm();
      });
    }

    arm();
  }

  void acknowledge(Object? stage) {
    if (stage is! String || !_acknowledged.add(stage)) return;
    _timers[stage]?.cancel();
  }

  void stop() {
    _stopped = true;
    for (final timer in _timers.values) {
      timer?.cancel();
    }
  }
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
    this.deliveryAckTimeout = const Duration(
      milliseconds: Contract.generationRequestAckTimeoutMs,
    ),
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

  /// How long a request frame waits for its acknowledgement before it is
  /// sent again (procedure `requestDelivery`).
  final Duration deliveryAckTimeout;

  /// Called when the advertisement or the proven identity changes.
  final void Function()? onChanged;

  late final StreamSubscription<String> _subscription;
  final List<_Waiter> _waiters = [];
  final Set<String> _signing = {};
  Advertisement? _advertisement;
  String? _proven;
  ({String local, String remote})? _provenBinding;
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
    _provenBinding = null;
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
    _provenBinding = binding;
    if (_proven != participantId) {
      _proven = participantId;
      onChanged?.call();
    }
    return participantId;
  }

  /// The identity proven on this connection with its current binding, or
  /// null. A proof stands while the connection and binding are unchanged
  /// (procedure `identityProofVerification`).
  String? get currentProof =>
      usable && _provenBinding != null && link.binding == _provenBinding
      ? _proven
      : null;

  /// The proven identity for a request: the current proof, or a fresh one.
  Future<String> provenProvider() async =>
      currentProof ?? await proveProvider();

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
  /// if the proof (reused from this connection or made now) names anyone
  /// else, nothing is sent. With
  /// [expectedRecipient] the wire policy stays open, but the prompt is sent
  /// only if the proof names the computer the person was shown.
  Stream<GenerationEvent> ask({
    required CatalogRow model,
    required List<Json> messages,
    String? contextId,
    String? namedRecipient,
    String? expectedRecipient,
    Set<String> blockedRecipients = const {},
  }) {
    late final StreamController<GenerationEvent> controller;
    String? requestId;
    _Delivery? delivering;
    _Waiter? acknowledging;
    var sent = false, done = false;

    Future<void> run() async {
      _reserved = true;
      try {
        final before = _advertisement;
        if (before == null || !usable || !before.selectable(model)) {
          throw const ProtocolFailure('No remote host slot available');
        }
        final proven = await provenProvider();
        if (done) return;
        if (namedRecipient != null && proven != namedRecipient) {
          throw const ProtocolFailure('Could not verify the paired desktop');
        }
        // The person was told this computer would read the prompt.
        if (expectedRecipient != null && proven != expectedRecipient ||
            namedRecipient == null && blockedRecipients.contains(proven)) {
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
        // Procedure `requestDelivery`: only a provider that acknowledges
        // frames and ignores repeats is ever sent one twice.
        final delivery = before.deliveryProtocol == null
            ? null
            : _Delivery(
                protocol: before.deliveryProtocol!,
                ackTimeout: deliveryAckTimeout,
              );
        Json framed(Json payload, int attempt) => delivery == null
            ? payload
            : {
                ...payload,
                'delivery': {'protocol': delivery.protocol, 'attempt': attempt},
              };
        if (utf8.encode(jsJson(framed(request, 1))).length >
            Contract.rtcMaxPayloadSize) {
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
        // A re-send goes to this same connection only, while it still holds
        // the binding and identity proven above; otherwise it is not sent.
        bool resend(String type, Json payload, int attempt) {
          if (done || !usable || currentProof != proven) return false;
          try {
            _send(type, framed(payload, attempt));
            return true;
          } on StateError {
            return false;
          }
        }

        final acknowledgements = delivery == null
            ? null
            : _Waiter((type, payload) {
                if (type == ChannelType.requestReceived &&
                    payload['requestId'] == id) {
                  delivery.acknowledge(payload['stage']);
                }
                return null;
              });
        delivering = delivery;
        if (acknowledgements != null) {
          // It never completes with a frame; a closed connection fails it.
          acknowledgements.completer.future.ignore();
          _waiters.add(acknowledgements);
          acknowledging = acknowledgements;
        }
        final admitted = _expect(
          (type, payload) =>
              failure(type, payload) ??
              (type == ChannelType.generationAdmitted &&
                      payload['requestId'] == id
                  ? payload
                  : null),
          onTimeout: 'Remote generation timed out',
        );
        final admit = admitPayload(request, commitment);
        _send(ChannelType.generationAdmit, framed(admit, 1));
        delivery?.sent(
          'admit',
          (attempt) => resend(ChannelType.generationAdmit, admit, attempt),
        );
        final Json admission;
        try {
          admission = await admitted;
        } finally {
          delivery?.acknowledge('admit');
        }
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
            // Output also shows the request arrived.
            delivery?.acknowledge('request');
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
        _send(ChannelType.generationRequest, framed(request, 1));
        sent = true;
        delivery?.sent(
          'request',
          (attempt) => resend(ChannelType.generationRequest, request, attempt),
        );
        controller.add(PromptDispatched(id, model.id));
        final Json result;
        try {
          result = await finished;
        } on ProtocolFailure catch (failure) {
          if (failure.message == 'Remote generation timed out') {
            _trySend(ChannelType.generationCancel, {'requestId': id});
          }
          rethrow;
        } finally {
          delivery?.stop();
          if (acknowledgements != null) _waiters.remove(acknowledgements);
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
        delivering?.stop();
        _waiters.remove(acknowledging);
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

  /// Procedure `recovery`. Proves the provider again and must find the same
  /// identity; anything that cannot be verified stays unresolved.
  Future<RecoveryOutcome> recover({
    required String requestId,
    required CatalogRow model,
    required List<Json> messages,
    required String providerParticipantId,
  }) async {
    if (await proveProvider() != providerParticipantId) {
      return const RecoveryUnresolved();
    }
    final queryId = entropy.uuid();
    final answered = _expect(
      (type, payload) =>
          type == ChannelType.generationRecovery &&
              payload['queryId'] == queryId &&
              payload['requestId'] == requestId
          ? payload
          : null,
      onTimeout: 'Remote generation timed out',
    );
    _send(ChannelType.generationRecover, {
      'queryId': queryId,
      'requestId': requestId,
    });
    final reply = await answered;
    final outcome = reply['outcome'];
    if (outcome is! Map<String, Object?>) return const RecoveryUnresolved();
    final data = outcome['payload'];
    if (data is! Map<String, Object?>) return const RecoveryUnresolved();
    if (outcome['type'] == ChannelType.generationError) {
      final status = await verifyTerminal(
        terminal: data['terminal'],
        requestId: requestId,
        modelId: model.id,
        modelIdentity: model.identity,
        messages: messages,
        provenProvider: providerParticipantId,
        ownParticipantId: identity.peerId,
      );
      return status == null
          ? const RecoveryUnresolved()
          : RecoveryEnded(status);
    }
    if (outcome['type'] != ChannelType.generationResult) {
      return const RecoveryUnresolved();
    }
    final receipt = data['receipt'];
    final Json signedPayload;
    try {
      signedPayload = await verifyResult(
        requestId: requestId,
        modelId: model.id,
        modelIdentity: model.identity,
        messages: messages,
        provenProvider: providerParticipantId,
        ownParticipantId: identity.peerId,
        earlyInputTokens: null,
        response: data['response'],
        receipt: receipt,
      );
    } on ProtocolFailure {
      return const RecoveryUnresolved();
    }
    final countersigned = await countersign(
      signedPayload,
      receipt! as Json,
      identity,
    );
    _trySend(ChannelType.receipt, {'receipt': countersigned});
    final response = data['response']! as Json;
    return RecoveryAnswered(response['content']! as String, countersigned);
  }

  Future<void> close() async => _closed();
}
