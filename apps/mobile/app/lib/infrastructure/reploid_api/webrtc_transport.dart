/// Signaling and WebRTC for the requester (procedure `signalingConnect`).
///
/// A WebSocket introduces this device to the computers in a room and carries
/// only the WebRTC setup. Everything else, the prompt included, travels on a
/// direct `reploid` data channel to the chosen computer.
///
/// This file needs a platform WebRTC implementation and has been exercised
/// only on macOS against a local signaling server; it has not run on a phone
/// or across real networks.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'contract.g.dart';
import 'peer_link.dart';
import 'peer_session.dart' show Entropy;
import 'requester_network.dart';
import 'requester_protocol.dart';
import 'signaling_config.dart';
import 'turn_client.dart';

export 'signaling_config.dart';

final class _Peer {
  _Peer(this.name, this.connection);
  final String name;
  final RTCPeerConnection connection;
  RTCDataChannel? channel;
  _RtcLink? link;
  bool remoteSet = false;
  bool unreachable = false;
  final List<RTCIceCandidate> pending = [];

  /// Frames that arrived after the channel opened but before its link
  /// existed. The other computer sends its advertisement at once.
  final List<String> early = [];
  Timer? deadline;
}

final class WebRtcMeshTransport implements MeshTransport {
  WebRtcMeshTransport({
    this.config = const SignalingConfig(),
    Entropy? entropy,
    TurnClient? turnClient,
    this.trace,
  }) : _name = (entropy ?? Entropy()).uuid(),
       _ownsTurnClient = turnClient == null,
       _turnClient =
           turnClient ??
           (config.rtcConfigUrl == null
               ? null
               : createTurnClient(
                   rtcConfigUrl: config.rtcConfigUrl,
                   origin: config.origin,
                   authToken: config.authToken,
                 ));

  final SignalingConfig config;
  final bool _ownsTurnClient;
  final TurnClient? _turnClient;

  /// Connection state names for a developer, never payloads or identities.
  final void Function(String line)? trace;

  /// This device's connection name for this run. Not a signing identity.
  final String _name;
  final Map<String, _Peer> _peers = {};
  final _links = StreamController<PeerLink>();
  final _statusChanges = StreamController<TransportStatus>.broadcast();
  WebSocket? _socket;
  Timer? _heartbeat;
  Timer? _retry;
  int _attempt = 0;
  bool _closed = false;
  Completer<void>? _joined;

  @override
  TransportStatus status = TransportStatus.offline;
  @override
  Stream<TransportStatus> get statusChanges => _statusChanges.stream;
  @override
  Stream<PeerLink> get links => _links.stream;

  void _set(TransportStatus next) {
    if (status == next || _closed) return;
    status = next;
    _statusChanges.add(next);
  }

  // Signaling -------------------------------------------------------------

  @override
  Future<void> open() async {
    if (_closed) throw StateError('The transport is closed');
    if (_socket != null) return _joined?.future;
    _retry?.cancel();
    _set(TransportStatus.connecting);
    final joined = _joined = Completer<void>();
    try {
      final socket = _socket = await WebSocket.connect(
        config.uri.toString(),
        headers: {'Origin': config.origin},
      ).timeout(_connectTimeout);
      socket.listen(
        (data) => data is String ? _frame(data) : null,
        onDone: () => _lost(socket),
        onError: (Object _) => _lost(socket),
        cancelOnError: true,
      );
      _sendFrame({
        'type': SignalingType.join,
        'peerId': _name,
        'roomId': config.roomId,
        'token': config.token,
        'metadata': {'capabilities': <Object?>[]},
      });
      await joined.future.timeout(_connectTimeout);
    } catch (_) {
      _lost(_socket);
      rethrow;
    }
  }

  static const _connectTimeout = Duration(
    milliseconds: Contract.signalingConnectTimeoutMs,
  );

  void _sendFrame(Json frame) {
    final text = jsonEncode(frame);
    if (utf8.encode(text).length > Contract.signalingMaxFrameBytes) return;
    try {
      _socket?.add(text);
    } on StateError {
      // The socket closed under us; _lost handles it.
    }
  }

  void _frame(String text) {
    final Object? frame;
    try {
      frame = jsonDecode(text);
    } on FormatException {
      return;
    }
    if (frame is! Map<String, Object?>) return;
    final from = frame['peerId'];
    switch (frame['type']) {
      case SignalingType.welcome:
        return; // not admission
      case SignalingType.joined:
        if (frame['peerId'] != _name || frame['roomId'] != config.roomId) {
          return _lost(_socket);
        }
        _attempt = 0;
        _heartbeat?.cancel();
        _heartbeat = Timer.periodic(
          const Duration(milliseconds: Contract.signalingHeartbeatMs),
          (_) => _sendFrame({
            'type': SignalingType.heartbeat,
            'peerId': _name,
            'roomId': config.roomId,
          }),
        );
        _set(TransportStatus.online);
        if (!(_joined?.isCompleted ?? true)) _joined!.complete();
        final peers = frame['peers'];
        trace?.call('joined: ${peers is List ? peers.length : 0} peers');
        if (peers is List) {
          for (final peer in peers.whereType<String>()) {
            if (peer != _name) unawaited(_offerTo(peer));
          }
        }
      case SignalingType.offer when from is String:
        unawaited(_answer(from, frame['offer']));
      case SignalingType.answer when from is String:
        trace?.call('answer received');
        unawaited(_accept(from, frame['answer']));
      case SignalingType.iceCandidate when from is String:
        unawaited(_candidate(from, frame['candidate']));
      case SignalingType.error || SignalingType.serverShutdown:
        _lost(_socket);
      default:
        // peer-joined: the newcomer offers. peer-left: an open channel
        // stays valid; its own state decides.
        return;
    }
  }

  /// Signaling is gone. Open data channels stay; the rest is dropped and
  /// signaling is retried with backoff.
  void _lost(WebSocket? socket) {
    if (socket != null && !identical(socket, _socket)) return;
    _socket = null;
    _heartbeat?.cancel();
    unawaited(socket?.close());
    final joined = _joined;
    if (joined != null && !joined.isCompleted) {
      joined.completeError(StateError('Signaling connection failed'));
    }
    for (final peer in List.of(_peers.values)) {
      if (peer.link == null) unawaited(_drop(peer));
    }
    if (_closed) return;
    _set(TransportStatus.offline);
    _attempt++;
    final wait = min(
      Contract.signalingReconnectBaseMs * (1 << min(_attempt - 1, 16)),
      Contract.signalingReconnectMaxMs,
    );
    _retry?.cancel();
    _retry = Timer(Duration(milliseconds: wait), () {
      if (!_closed && _socket == null) unawaited(open().catchError((_) {}));
    });
  }

  // Peer connections ------------------------------------------------------------

  Future<_Peer> _create(String name) async {
    final previous = _peers.remove(name);
    if (previous != null) await _drop(previous);
    final turnConfig = await _turnClient?.fetchTurnConfig();
    final rtcConfiguration = turnConfig != null
        ? turnConfig.toPeerConnectionConfiguration()
        : {
            'iceServers': [
              for (final url in config.iceServerUrls) {'urls': url},
            ],
            'iceTransportPolicy': 'all',
          };
    if (config.forceRelay) rtcConfiguration['iceTransportPolicy'] = 'relay';
    // Counts and policy only: never URLs, usernames or credentials.
    trace?.call(
      turnConfig == null
          ? 'rtc-config: no TURN credentials, '
                '${config.iceServerUrls.length} STUN servers'
          : 'rtc-config: TURN credentials, '
                '${turnConfig.iceServers.length} ICE servers',
    );
    trace?.call('ice policy ${rtcConfiguration['iceTransportPolicy']}');
    final connection = await createPeerConnection(rtcConfiguration);
    final peer = _peers[name] = _Peer(name, connection);
    connection.onIceCandidate = (candidate) {
      if (candidate.candidate == null) return;
      _sendFrame({
        'type': SignalingType.iceCandidate,
        'peerId': _name,
        'targetPeer': name,
        'candidate': {
          'candidate': candidate.candidate,
          'sdpMid': candidate.sdpMid,
          'sdpMLineIndex': candidate.sdpMLineIndex,
        },
      });
    };
    connection.onIceConnectionState = (state) {
      trace?.call('ice ${state.name}');
      if (trace != null &&
          (state == RTCIceConnectionState.RTCIceConnectionStateConnected ||
              state == RTCIceConnectionState.RTCIceConnectionStateCompleted)) {
        unawaited(_traceSelectedPair(connection));
      }
      peer.unreachable = const {
        RTCIceConnectionState.RTCIceConnectionStateDisconnected,
        RTCIceConnectionState.RTCIceConnectionStateFailed,
        RTCIceConnectionState.RTCIceConnectionStateClosed,
      }.contains(state);
      if (state == RTCIceConnectionState.RTCIceConnectionStateFailed ||
          state == RTCIceConnectionState.RTCIceConnectionStateClosed) {
        unawaited(_drop(peer));
      }
    };
    peer.deadline = Timer(_connectTimeout, () {
      if (peer.link == null) unawaited(_drop(peer));
    });
    return peer;
  }

  /// Logs the candidate types of the pair in use, `relay` when the traffic
  /// goes through TURN. Types and protocol only, never addresses.
  Future<void> _traceSelectedPair(RTCPeerConnection connection) async {
    try {
      final reports = await connection.getStats();
      final byId = {for (final report in reports) report.id: report};
      String? pairId;
      for (final report in reports) {
        if (report.type == 'transport') {
          pairId = report.values['selectedCandidatePairId']?.toString();
          if (pairId != null) break;
        }
      }
      pairId ??= [
        for (final report in reports)
          if (report.type == 'candidate-pair' &&
              report.values['state'] == 'succeeded' &&
              (report.values['nominated'] == true ||
                  report.values['selected'] == true))
            report.id,
      ].firstOrNull;
      final pair = byId[pairId];
      if (pair == null) {
        trace?.call('selected pair: unknown');
        return;
      }
      String describe(Object? id) {
        final candidate = byId[id?.toString()];
        if (candidate == null) return 'unknown';
        final values = candidate.values;
        final relayProtocol = values['relayProtocol'];
        return '${values['candidateType'] ?? 'unknown'}/'
            '${values['protocol'] ?? '?'}'
            '${relayProtocol == null ? '' : ' via $relayProtocol'}';
      }

      trace?.call(
        'selected pair: local ${describe(pair.values['localCandidateId'])}, '
        'remote ${describe(pair.values['remoteCandidateId'])}',
      );
    } catch (error) {
      trace?.call('selected pair: stats failed (${error.runtimeType})');
    }
  }

  Future<void> _offerTo(String name) async {
    try {
      final peer = await _create(name);
      _adopt(
        peer,
        await peer.connection.createDataChannel(
          Contract.rtcChannelLabel,
          RTCDataChannelInit()..ordered = Contract.rtcOrdered,
        ),
      );
      final offer = await peer.connection.createOffer();
      await peer.connection.setLocalDescription(offer);
      _sendFrame({
        'type': SignalingType.offer,
        'peerId': _name,
        'targetPeer': name,
        'offer': {'type': offer.type, 'sdp': offer.sdp},
      });
    } catch (error) {
      trace?.call('offer failed: ${error.runtimeType}');
      final peer = _peers[name];
      if (peer != null) await _drop(peer);
    }
  }

  Future<void> _answer(String name, Object? offer) async {
    if (offer is! Map || offer['sdp'] is! String) return;
    if (_peers[name]?.link?.isOpen ?? false) return;
    try {
      final peer = await _create(name);
      peer.connection.onDataChannel = (channel) {
        if (channel.label == Contract.rtcChannelLabel) {
          _adopt(peer, channel);
        } else {
          unawaited(channel.close());
        }
      };
      await peer.connection.setRemoteDescription(
        RTCSessionDescription(offer['sdp'] as String, 'offer'),
      );
      await _flush(peer);
      final answer = await peer.connection.createAnswer();
      await peer.connection.setLocalDescription(answer);
      _sendFrame({
        'type': SignalingType.answer,
        'peerId': _name,
        'targetPeer': name,
        'answer': {'type': answer.type, 'sdp': answer.sdp},
      });
    } catch (_) {
      final peer = _peers[name];
      if (peer != null) await _drop(peer);
    }
  }

  Future<void> _accept(String name, Object? answer) async {
    final peer = _peers[name];
    if (peer == null || answer is! Map || answer['sdp'] is! String) return;
    try {
      await peer.connection.setRemoteDescription(
        RTCSessionDescription(answer['sdp'] as String, 'answer'),
      );
      await _flush(peer);
    } catch (_) {
      await _drop(peer);
    }
  }

  Future<void> _flush(_Peer peer) async {
    peer.remoteSet = true;
    final waiting = List.of(peer.pending);
    peer.pending.clear();
    for (final candidate in waiting) {
      await peer.connection.addCandidate(candidate);
    }
  }

  Future<void> _candidate(String name, Object? value) async {
    final peer = _peers[name];
    if (peer == null || value is! Map || value['candidate'] is! String) return;
    final index = value['sdpMLineIndex'];
    final candidate = RTCIceCandidate(
      value['candidate'] as String,
      value['sdpMid'] is String ? value['sdpMid'] as String : null,
      index is num ? index.toInt() : null,
    );
    if (!peer.remoteSet) {
      // Kept until the remote description is set; the contract caps how many.
      if (peer.pending.length < 32) peer.pending.add(candidate);
      return;
    }
    try {
      await peer.connection.addCandidate(candidate);
    } catch (_) {
      // A candidate that cannot be added costs one path, not the connection.
    }
  }

  void _adopt(_Peer peer, RTCDataChannel channel) {
    peer.channel = channel;
    Future<void> opened() async {
      if (peer.link != null || _closed) return;
      final local = sdpFingerprint(
        (await peer.connection.getLocalDescription())?.sdp,
      );
      final remote = sdpFingerprint(
        (await peer.connection.getRemoteDescription())?.sdp,
      );
      trace?.call(
        'open: local fingerprint ${local != null}, remote ${remote != null}',
      );
      if (peer.link != null || !identical(_peers[peer.name], peer)) return;
      peer.deadline?.cancel();
      final link = peer.link = _RtcLink(
        peer,
        local == null || remote == null ? null : (local: local, remote: remote),
        roomId: config.roomId,
        selfId: _name,
      );
      peer.early.forEach(link._incoming.add);
      peer.early.clear();
      _links.add(link);
    }

    channel.onDataChannelState = (state) {
      trace?.call('channel ${state.name}');
      if (state == RTCDataChannelState.RTCDataChannelOpen) {
        unawaited(opened());
      } else if (state == RTCDataChannelState.RTCDataChannelClosed) {
        unawaited(_drop(peer));
      }
    };
    channel.onMessage = (message) {
      if (message.isBinary) return;
      final link = peer.link;
      if (link != null) {
        link._incoming.add(message.text);
      } else if (peer.early.length < 64) {
        peer.early.add(message.text);
      }
    };
    if (channel.state == RTCDataChannelState.RTCDataChannelOpen) {
      unawaited(opened());
    }
  }

  Future<void> _drop(_Peer peer) async {
    if (identical(_peers[peer.name], peer)) _peers.remove(peer.name);
    peer.deadline?.cancel();
    peer.link?._end();
    try {
      await peer.channel?.close();
      await peer.connection.close();
    } catch (_) {
      // Already closed by the platform.
    }
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _sendFrame({
      'type': SignalingType.leave,
      'peerId': _name,
      'roomId': config.roomId,
    });
    _closed = true;
    _retry?.cancel();
    _heartbeat?.cancel();
    final socket = _socket;
    _socket = null;
    await socket?.close();
    for (final peer in List.of(_peers.values)) {
      await _drop(peer);
    }
    if (_ownsTurnClient) _turnClient?.close();
    status = TransportStatus.offline;
    await _links.close();
    await _statusChanges.close();
  }
}

final class _RtcLink implements PeerLink {
  _RtcLink(
    this._peer,
    this._binding, {
    required this.roomId,
    required this.selfId,
  });

  @override
  final String roomId;
  @override
  final String selfId;
  final _Peer _peer;
  final ({String local, String remote})? _binding;
  final _incoming = StreamController<String>();
  final _closed = Completer<void>();

  @override
  String get peerId => _peer.name;

  /// Procedure `sdpFingerprint`: available only while the channel is open.
  @override
  ({String local, String remote})? get binding => isOpen ? _binding : null;

  @override
  bool get isOpen =>
      !_closed.isCompleted &&
      !_peer.unreachable &&
      _peer.channel?.state == RTCDataChannelState.RTCDataChannelOpen;

  @override
  void send(String text) {
    final channel = _peer.channel;
    if (channel == null || !isOpen) throw StateError('The link is closed');
    if ((channel.bufferedAmount ?? 0) + utf8.encode(text).length >
        Contract.rtcSendBufferLimitBytes) {
      throw StateError('The send buffer is full');
    }
    unawaited(channel.send(RTCDataChannelMessage(text)).catchError((_) {}));
  }

  @override
  Stream<String> get texts => _incoming.stream;

  @override
  Future<void> get closed => _closed.future;

  void _end() {
    if (_closed.isCompleted) return;
    _closed.complete();
    unawaited(_incoming.close());
  }
}
