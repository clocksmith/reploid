import 'contract.g.dart';

/// Where to meet other computers. The defaults are the public network.
final class SignalingConfig {
  const SignalingConfig({
    this.url = Contract.signalingPublicUrl,
    this.roomId = Contract.signalingPublicRoomId,
    this.token = Contract.signalingPublicJoinToken,
    this.origin = Contract.signalingDefaultNativeOrigin,
    this.iceServerUrls = Contract.rtcIceServerUrls,
    this.rtcConfigUrl = defaultPublicRtcConfigUrl,
    this.authToken,
  });

  static const defaultPublicRtcConfigUrl =
      'https://reploid-swarm.reploid.workers.dev/rtc-config';

  final String url;
  final String roomId;
  final String token;

  /// The signaling service refuses a WebSocket without an allowed Origin.
  final String origin;
  final List<String> iceServerUrls;

  /// Optional HTTPS endpoint returning `reploid.pool.turn_credentials/v1`.
  /// When null or unavailable, the transport connects with [iceServerUrls].
  final String? rtcConfigUrl;

  /// Optional Firebase/bearer token sent to [rtcConfigUrl].
  final String? authToken;

  bool get public => roomId == Contract.signalingPublicRoomId;

  Uri get uri => Uri.parse(url).replace(
    queryParameters: {'scope': public ? 'public' : 'private', 'roomId': roomId},
  );
}
