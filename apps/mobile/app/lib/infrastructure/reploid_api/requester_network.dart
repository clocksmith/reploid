/// Every connection of one requester: which computers are there, which of
/// them can answer, and the choice of one for a request (procedures
/// `readyPeerRule` and `providerSelectionRule`).
library;

import 'dart:async';

import 'contract.g.dart';
import 'identity.dart';
import 'peer_link.dart';
import 'peer_session.dart';
import 'requester_protocol.dart';

enum TransportStatus { offline, connecting, online }

/// Whatever makes connections: signaling and WebRTC in the app, a text
/// pipe to the web client's provider code in tests.
abstract interface class MeshTransport {
  TransportStatus get status;
  Stream<TransportStatus> get statusChanges;

  /// Each `reploid` data channel, once, when it opens.
  Stream<PeerLink> get links;
  Future<void> open();
  Future<void> close();
}

/// One connected computer as the requester currently knows it.
final class PeerView {
  const PeerView({
    required this.name,
    required this.usable,
    this.advertisement,
    this.participantId,
  });

  /// The connection name. It changes with every connection.
  final String name;
  final bool usable;
  final Advertisement? advertisement;

  /// Set once this computer has proven its signing identity here.
  final String? participantId;
}

final class NetworkView {
  NetworkView(this.status, List<PeerView> peers)
    : peers = List.unmodifiable(peers);
  final TransportStatus status;
  final List<PeerView> peers;
}

final class RequesterNetwork {
  RequesterNetwork({
    required this.transport,
    required this.identity,
    Entropy? entropy,
    int Function()? now,
    this.discoveryTimeout = const Duration(
      milliseconds: Contract.generationDiscoveryTimeoutMs,
    ),
  }) : _entropy = entropy ?? Entropy(),
       _now = now ?? (() => DateTime.now().millisecondsSinceEpoch) {
    _links = transport.links.listen(_adopt);
    _status = transport.statusChanges.listen((_) => _publish());
  }

  final MeshTransport transport;
  final SigningIdentity identity;
  final Duration discoveryTimeout;
  final Entropy _entropy;
  final int Function() _now;
  final _clock = LamportClock();
  final Map<String, PeerSession> _sessions = {};
  final Set<String> _observing = {};
  final Map<String, String> _lastProvider = {};
  final _changes = StreamController<void>.broadcast();
  late final StreamSubscription<PeerLink> _links;
  late final StreamSubscription<TransportStatus> _status;
  bool _closed = false;

  void _publish() {
    if (!_closed) _changes.add(null);
  }

  void _adopt(PeerLink link) {
    if (_closed) return;
    final name = link.peerId;
    unawaited(_sessions.remove(name)?.close());
    late final PeerSession session;
    session = PeerSession(
      link: link,
      identity: identity,
      clock: _clock,
      entropy: _entropy,
      now: _now,
      onChanged: () {
        if (session.isClosed) {
          if (identical(_sessions[name], session)) _sessions.remove(name);
        } else {
          _observe(name, session);
        }
        _publish();
      },
    );
    _sessions[name] = session;
    _publish();
  }

  /// Learns a provider's identity in the background, so the list of
  /// computers can name them. A request never relies on this proof; it
  /// asks for a fresh one.
  void _observe(String name, PeerSession session, {bool anyRole = false}) {
    if (session.provenParticipantId != null ||
        (!anyRole && session.advertisement?.role != 'provider') ||
        !session.usable ||
        !_observing.add(name)) {
      return;
    }
    unawaited(() async {
      try {
        await session.proveProvider();
      } on ProtocolFailure {
        // Unproven computers are listed without an identity.
      } on StateError {
        // The link closed while asking.
      } finally {
        _observing.remove(name);
      }
    }());
  }

  NetworkView get view => NetworkView(transport.status, [
    for (final entry in _sessions.entries)
      PeerView(
        name: entry.key,
        usable: entry.value.usable,
        advertisement: entry.value.advertisement,
        participantId: entry.value.provenParticipantId,
      ),
  ]);

  /// The current view, then every change.
  Stream<NetworkView> watch() => Stream.multi((controller) {
    final subscription = _changes.stream.listen(
      (_) => controller.addSync(view),
      onDone: controller.closeSync,
    );
    controller.addSync(view);
    controller.onCancel = subscription.cancel;
  });

  Future<void> open() => transport.open();

  /// Procedure `pairedDesktopRecognition`: the connection whose identity,
  /// proven on that connection, is [participantId]. Nothing else counts:
  /// not a name, a label, or what a computer says about itself.
  PeerSession? proven(String participantId) {
    for (final session in _sessions.values) {
      if (session.usable && session.provenParticipantId == participantId) {
        return session;
      }
    }
    return null;
  }

  /// Procedure `pairingExchange`, steps 4 to 9. Looks for the desktop for
  /// [search], then asks it to pair. Returns whether the owner approved.
  Future<bool> pair({
    required String code,
    required String hostParticipantId,
    Duration search = const Duration(
      milliseconds: Contract.pairingHostSearchMs,
    ),
    Duration wait = const Duration(
      milliseconds: Contract.pairingApprovalWaitMs,
    ),
    void Function()? onAsked,
  }) async {
    final end = DateTime.now().add(search);
    PeerSession? desktop;
    while ((desktop = proven(hostParticipantId)) == null) {
      // A computer is proven in the background after it advertises itself;
      // ones that never advertise are asked here.
      for (final entry in _sessions.entries) {
        if (entry.value.usable && entry.value.provenParticipantId == null) {
          _observe(entry.key, entry.value, anyRole: true);
        }
      }
      if (_closed || DateTime.now().isAfter(end)) {
        throw const ProtocolFailure(
          'Could not find the verified desktop on this connection. '
          'Confirm it is online and retry.',
        );
      }
      await Future<void>.delayed(const Duration(milliseconds: 100));
    }
    return desktop!.requestPairing(
      code: code,
      hostParticipantId: hostParticipantId,
      wait: wait,
      onSent: onAsked,
    );
  }

  /// Identities and connection names this device never sends a contributor
  /// request to. A named recipient is the person's own choice and is exempt.
  Set<String> blocked = const {};

  bool _isBlocked(String name, PeerSession session) =>
      blocked.contains(name) ||
      (session.provenParticipantId != null &&
          blocked.contains(session.provenParticipantId));

  /// Procedure `providerSelectionRule`: the best candidate now, or null.
  /// With [namedRecipient], only the connection proven to be that identity
  /// (procedure `pairedDesktopRequest`); never anyone else.
  PeerSession? _select(
    CatalogRow model,
    String? contextId,
    String? namedRecipient, {
    String? expectedRecipient,
  }) {
    final nowMs = _now();
    final candidates = [
      for (final entry in _sessions.entries)
        if (entry.value.usable &&
            !entry.value.reserved &&
            (namedRecipient != null || !_isBlocked(entry.key, entry.value)) &&
            (namedRecipient == null ||
                entry.value.provenParticipantId == namedRecipient) &&
            (expectedRecipient == null ||
                entry.value.provenParticipantId == expectedRecipient) &&
            (entry.value.advertisement?.selectable(model) ?? false))
          entry,
    ];
    if (candidates.isEmpty) return null;
    final preferred = contextId == null ? null : _lastProvider[contextId];
    for (final entry in candidates) {
      if (entry.key == preferred) return entry.value;
    }
    candidates.sort((a, b) {
      final first = a.value.advertisement!, second = b.value.advertisement!;
      final score = second
          .contributionScore(nowMs)
          .compareTo(first.contributionScore(nowMs));
      if (score != 0) return score;
      final peers = second.uniquePeers.compareTo(first.uniquePeers);
      return peers != 0 ? peers : a.key.compareTo(b.key);
    });
    return candidates.first.value;
  }

  /// The proven identity [ask] would choose right now, so the screen can
  /// name it before Send. Null when none is ready, or the best is unproven.
  String? nextRecipient(CatalogRow model, String? contextId) =>
      _select(model, contextId, null)?.provenParticipantId;

  /// Procedure `recovery`, on the connection now proven to be the provider.
  /// With no such connection the request simply stays unresolved.
  Future<RecoveryOutcome> recover({
    required String requestId,
    required CatalogRow model,
    required List<Json> messages,
    required String providerParticipantId,
  }) async {
    final session = proven(providerParticipantId);
    if (session == null) return const RecoveryUnresolved();
    return session.recover(
      requestId: requestId,
      model: model,
      messages: messages,
      providerParticipantId: providerParticipantId,
    );
  }

  /// One whole-model request to the best ready computer. Waits up to
  /// [discoveryTimeout] for one to appear; nothing is sent while waiting.
  Stream<GenerationEvent> ask({
    required CatalogRow model,
    required List<Json> messages,
    String? contextId,
    String? namedRecipient,
    String? expectedRecipient,
  }) {
    late final StreamController<GenerationEvent> controller;
    StreamSubscription<GenerationEvent>? inner;
    StreamSubscription<void>? waiting;
    Timer? deadline;
    var cancelled = false;

    void start(PeerSession session) {
      if (contextId != null) _lastProvider[contextId] = session.link.peerId;
      inner = session
          .ask(
            model: model,
            messages: messages,
            contextId: contextId,
            namedRecipient: namedRecipient,
            expectedRecipient: expectedRecipient,
            blockedRecipients: blocked,
          )
          .listen(
            controller.add,
            onError: controller.addError,
            onDone: controller.close,
          );
    }

    void attempt() {
      if (cancelled || inner != null) return;
      final session = _select(
        model,
        contextId,
        namedRecipient,
        expectedRecipient: expectedRecipient,
      );
      if (session == null) return;
      deadline?.cancel();
      unawaited(waiting?.cancel());
      start(session);
    }

    controller = StreamController<GenerationEvent>(
      onListen: () {
        if (_closed) {
          controller.addError(
            const ProtocolFailure('No remote host slot available'),
          );
          unawaited(controller.close());
          return;
        }
        waiting = _changes.stream.listen((_) => attempt());
        deadline = Timer(discoveryTimeout, () {
          if (inner != null || cancelled) return;
          unawaited(waiting?.cancel());
          controller.addError(
            const ProtocolFailure('No remote host slot available'),
          );
          unawaited(controller.close());
        });
        attempt();
      },
      onCancel: () async {
        cancelled = true;
        deadline?.cancel();
        await waiting?.cancel();
        await inner?.cancel();
      },
    );
    return controller.stream;
  }

  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await _links.cancel();
    await _status.cancel();
    for (final session in List.of(_sessions.values)) {
      await session.close();
    }
    _sessions.clear();
    await transport.close();
    await _changes.close();
  }
}
