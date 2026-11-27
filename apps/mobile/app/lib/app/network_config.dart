import '../features/chat/domain/chat.dart';
import '../features/chat/infrastructure/contract_requester_api.dart';
import '../features/chat/infrastructure/pairing_store.dart';
import '../features/chat/infrastructure/requester_api.dart';
import '../infrastructure/device_stores.dart';
import '../infrastructure/reploid_api/identity.dart';
import '../infrastructure/reploid_api/mesh_transport_factory.dart';
import '../infrastructure/reploid_api/requester_network.dart';

/// Build-time defaults and runtime signaling adapter builder for the app.
///
/// Build-time overrides:
///   --dart-define=REPLOID_NETWORK=demo     the in-app synthetic network (default)
///   --dart-define=REPLOID_NETWORK=public   the public Reploid network
///   --dart-define=REPLOID_NETWORK=room     a private room, with
///       REPLOID_SIGNALING_URL, REPLOID_ROOM and REPLOID_TOKEN, and optionally
///       REPLOID_ORIGIN, REPLOID_ICE (comma-separated URLs),
///       REPLOID_RTC_CONFIG_URL, and REPLOID_AUTH_TOKEN.
///   --dart-define=REPLOID_ICE_POLICY=relay  connect only through TURN relay
///   --dart-define=REPLOID_TRACE=true        print connection steps to the log
///
/// Users can also switch between Demo, Public, and a Private room at runtime
/// in Settings; the selection is persisted in the platform keystore.
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
  static const _rtcConfigUrl = String.fromEnvironment('REPLOID_RTC_CONFIG_URL');
  static const _authToken = String.fromEnvironment('REPLOID_AUTH_TOKEN');
  static const _trace = bool.fromEnvironment('REPLOID_TRACE');
  static const _forceRelay =
      String.fromEnvironment('REPLOID_ICE_POLICY') == 'relay';

  static bool get hasBuildTimeOverride => network != 'demo';

  static NetworkPreference buildTimePreference() => switch (network) {
    'public' => const NetworkPreference(
      mode: NetworkMode.public,
      origin: _origin,
      rtcConfigUrl: _rtcConfigUrl,
    ),
    'room' when _url != '' && _room != '' && _token != '' => NetworkPreference(
      mode: NetworkMode.room,
      signalingUrl: _url,
      roomId: _room,
      token: _token,
      origin: _origin,
      rtcConfigUrl: _rtcConfigUrl,
    ),
    _ => const NetworkPreference(),
  };

  static SignalingConfig? get signaling => signalingFor(buildTimePreference());

  static List<String> _iceServers() => _ice == '-'
      ? const SignalingConfig().iceServerUrls
      : [
          for (final url in _ice.split(','))
            if (url.trim().isNotEmpty) url.trim(),
        ];

  static SignalingConfig? signalingFor(NetworkPreference preference) {
    final origin = preference.origin.trim().isNotEmpty
        ? preference.origin.trim()
        : _origin.isNotEmpty
        ? _origin
        : const SignalingConfig().origin;
    final authToken = _authToken.trim().isEmpty ? null : _authToken.trim();
    return switch (preference.mode) {
      NetworkMode.demo => null,
      NetworkMode.public => SignalingConfig(
        origin: origin,
        iceServerUrls: _iceServers(),
        rtcConfigUrl: preference.rtcConfigUrl.trim().isNotEmpty
            ? preference.rtcConfigUrl.trim()
            : SignalingConfig.defaultPublicRtcConfigUrl,
        authToken: authToken,
        forceRelay: _forceRelay,
      ),
      NetworkMode.room when preference.isValid => SignalingConfig(
        url: preference.signalingUrl.trim(),
        roomId: preference.roomId.trim(),
        token: preference.token.trim(),
        origin: origin,
        iceServerUrls: _iceServers(),
        rtcConfigUrl: preference.rtcConfigUrl.trim().isNotEmpty
            ? preference.rtcConfigUrl.trim()
            : null,
        authToken: authToken,
        forceRelay: _forceRelay,
      ),
      NetworkMode.room => null,
    };
  }

  static RequesterApi createContractApi({
    required SignalingConfig config,
    required SigningIdentity identity,
    required SecretStore secrets,
  }) {
    RequesterNetwork join(SignalingConfig room) => RequesterNetwork(
      transport: createMeshTransport(
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
          rtcConfigUrl: config.rtcConfigUrl,
          authToken: config.authToken,
          forceRelay: config.forceRelay,
        ),
      ),
    );
  }
}
