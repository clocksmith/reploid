import 'package:flutter_riverpod/misc.dart' show Override;

import '../features/chat/infrastructure/contract_requester_api.dart';
import '../features/chat/infrastructure/pairing_store.dart';
import '../infrastructure/reploid_api/requester_network.dart';
import '../infrastructure/reploid_api/webrtc_transport.dart';
import 'providers.dart';

/// Which network a build talks to, chosen at build time:
///
///   --dart-define=REPLOID_NETWORK=demo     the in-app synthetic network (default)
///   --dart-define=REPLOID_NETWORK=public   the public Reploid network
///   --dart-define=REPLOID_NETWORK=room     a private room, with
///       REPLOID_SIGNALING_URL, REPLOID_ROOM and REPLOID_TOKEN, and optionally
///       REPLOID_ORIGIN and REPLOID_ICE (comma-separated server URLs)
///
/// A build never changes network at run time, and screens say so while it
/// is the demo network.
abstract final class NetworkConfig {
  static const network = String.fromEnvironment(
    'REPLOID_NETWORK',
    defaultValue: 'demo',
  );
  static const _url = String.fromEnvironment('REPLOID_SIGNALING_URL');
  static const _room = String.fromEnvironment('REPLOID_ROOM');
  static const _token = String.fromEnvironment('REPLOID_TOKEN');
  static const _origin = String.fromEnvironment('REPLOID_ORIGIN');
  static const _ice = String.fromEnvironment('REPLOID_ICE', defaultValue: '-');
  static const _trace = bool.fromEnvironment('REPLOID_TRACE');

  static SignalingConfig? get signaling => switch (network) {
    'public' => const SignalingConfig(),
    'room' when _url != '' && _room != '' && _token != '' => SignalingConfig(
      url: _url,
      roomId: _room,
      token: _token,
      origin: _origin == '' ? const SignalingConfig().origin : _origin,
      iceServerUrls: _ice == '-'
          ? const SignalingConfig().iceServerUrls
          : [
              for (final url in _ice.split(','))
                if (url.trim().isNotEmpty) url.trim(),
            ],
    ),
    _ => null,
  };

  /// Provider overrides for the configured network; none for the demo.
  static List<Override> overrides() {
    final config = signaling;
    if (config == null) return const [];
    return [
      demoNetworkProvider.overrideWithValue(false),
      requesterApiFactoryProvider.overrideWithValue((identity, secrets) {
        RequesterNetwork join(SignalingConfig room) => RequesterNetwork(
          transport: WebRtcMeshTransport(
            config: room,
            // ignore: avoid_print
            trace: _trace ? (line) => print('transport: $line') : null,
          ),
          identity: identity,
        );
        return ContractRequesterApi(
          join(config),
          pairings: PairingStore(secrets, identity.peerId),
          // A paired desktop waits in a private room of its own, on the
          // same signaling service.
          joinRoom: (roomId, token) => join(
            SignalingConfig(
              url: config.url,
              roomId: roomId,
              token: token,
              origin: config.origin,
              iceServerUrls: config.iceServerUrls,
            ),
          ),
        );
      }),
    ];
  }
}
