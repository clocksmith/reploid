import 'turn_types.dart';

final class _WebTurnClient implements TurnClient {
  @override
  Future<RtcConfiguration?> fetchTurnConfig() async => null;

  @override
  Future<SwarmBootstrapConfig?> fetchBootstrap(Uri url) async => null;

  @override
  void close() {}
}

TurnClient createPlatformTurnClient({
  required String? rtcConfigUrl,
  required String origin,
  String? authToken,
}) => _WebTurnClient();
