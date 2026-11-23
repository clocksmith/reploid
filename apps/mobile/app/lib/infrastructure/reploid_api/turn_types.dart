import 'contract.g.dart';

/// One ICE server entry passed to `createPeerConnection`.
final class RtcIceServer {
  const RtcIceServer({
    required this.urls,
    this.username,
    this.credential,
    this.credentialType,
  });

  final List<String> urls;
  final String? username;
  final String? credential;
  final String? credentialType;

  Map<String, Object?> toRtcMap() => {
    'urls': urls.length == 1 ? urls.first : urls,
    if (username != null) 'username': username,
    if (credential != null) 'credential': credential,
    if (credentialType != null) 'credentialType': credentialType,
  };
}

/// Ephemeral TURN/ICE configuration parsed from `reploid.pool.turn_credentials/v1`.
final class RtcConfiguration {
  RtcConfiguration({
    required List<RtcIceServer> iceServers,
    this.iceTransportPolicy = 'all',
    this.expiresAt,
  }) : iceServers = List.unmodifiable(iceServers);

  final List<RtcIceServer> iceServers;
  final String iceTransportPolicy;
  final DateTime? expiresAt;

  Map<String, Object?> toPeerConnectionConfiguration() => {
    'iceServers': [for (final server in iceServers) server.toRtcMap()],
    'iceTransportPolicy': iceTransportPolicy,
  };

  bool isFresh(DateTime now, Duration refreshSkew) {
    final expiry = expiresAt;
    if (expiry == null) return false;
    return now.add(refreshSkew).isBefore(expiry);
  }
}

/// Public discovery bootstrap parsed from `reploid.swarm-bootstrap/v1`.
final class SwarmBootstrapConfig {
  const SwarmBootstrapConfig({
    required this.signalingUrl,
    required this.publicRoomId,
    required this.publicJoinMarker,
    this.rtcConfigUrl,
    this.rtcRefreshSkewMs = 60000,
  });

  final String signalingUrl;
  final String publicRoomId;
  final String publicJoinMarker;
  final String? rtcConfigUrl;
  final int rtcRefreshSkewMs;
}

/// Parses a `reploid.pool.turn_credentials/v1` JSON response; returns null
/// when invalid or incomplete so the caller falls back to direct ICE servers.
RtcConfiguration? parseTurnCredentialsResponse(Object? value) {
  if (value is! Map) return null;
  if (value['schema'] != Contract.idTurnCredentials) return null;
  final rtc = value['rtcConfig'];
  if (rtc is! Map) return null;
  final rawServers = rtc['iceServers'];
  if (rawServers is! List || rawServers.isEmpty || rawServers.length > 8) {
    return null;
  }
  final policy = rtc['iceTransportPolicy'];
  final iceTransportPolicy = policy == 'relay' || policy == 'all'
      ? policy as String
      : 'all';
  final servers = <RtcIceServer>[];
  for (final item in rawServers) {
    if (item is! Map) return null;
    final rawUrls = item['urls'];
    final List<String> urls;
    if (rawUrls is String && rawUrls.trim().isNotEmpty) {
      urls = [rawUrls.trim()];
    } else if (rawUrls is List) {
      urls = [
        for (final entry in rawUrls)
          if (entry is String && entry.trim().isNotEmpty) entry.trim(),
      ];
    } else {
      return null;
    }
    if (urls.isEmpty || urls.length > 16) return null;
    final username = item['username'] is String
        ? item['username'] as String
        : null;
    final credential = item['credential'] is String
        ? item['credential'] as String
        : null;
    final credentialType = item['credentialType'] is String
        ? item['credentialType'] as String
        : null;
    final hasTurn = urls.any(
      (url) => url.startsWith('turn:') || url.startsWith('turns:'),
    );
    if (hasTurn &&
        ((username == null || username.isEmpty) ||
            (credential == null || credential.isEmpty))) {
      return null;
    }
    servers.add(
      RtcIceServer(
        urls: urls,
        username: username,
        credential: credential,
        credentialType: credentialType,
      ),
    );
  }
  if (servers.isEmpty) return null;
  final expiresRaw = value['expiresAt'];
  final expiresAt = expiresRaw is String ? DateTime.tryParse(expiresRaw) : null;
  return RtcConfiguration(
    iceServers: servers,
    iceTransportPolicy: iceTransportPolicy,
    expiresAt: expiresAt,
  );
}

/// Parses a `reploid.swarm-bootstrap/v1` JSON document; returns null if invalid.
SwarmBootstrapConfig? parseSwarmBootstrapResponse(Object? value) {
  if (value is! Map) return null;
  if (value['schema'] != Contract.idSwarmBootstrap) return null;
  final signalingUrl = value['signalingUrl'];
  final publicRoomId = value['publicRoomId'];
  final publicJoinMarker = value['publicJoinMarker'];
  if (signalingUrl is! String ||
      signalingUrl.trim().isEmpty ||
      publicRoomId is! String ||
      publicRoomId.trim().isEmpty ||
      publicJoinMarker is! String ||
      publicJoinMarker.trim().isEmpty) {
    return null;
  }
  final rtcConfigUrl = value['rtcConfigUrl'] is String
      ? (value['rtcConfigUrl'] as String).trim()
      : null;
  final skew = value['rtcRefreshSkewMs'];
  return SwarmBootstrapConfig(
    signalingUrl: signalingUrl.trim(),
    publicRoomId: publicRoomId.trim(),
    publicJoinMarker: publicJoinMarker.trim(),
    rtcConfigUrl: rtcConfigUrl == null || rtcConfigUrl.isEmpty
        ? null
        : rtcConfigUrl,
    rtcRefreshSkewMs: skew is int && skew >= 0 ? skew : 60000,
  );
}

/// Fetches ephemeral TURN credentials and optional swarm bootstrap over HTTPS.
abstract interface class TurnClient {
  Future<RtcConfiguration?> fetchTurnConfig();
  Future<SwarmBootstrapConfig?> fetchBootstrap(Uri url);
  void close();
}
