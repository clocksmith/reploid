import 'turn_client_web.dart'
    if (dart.library.io) 'turn_client_io.dart'
    as platform;
import 'turn_types.dart';

export 'turn_types.dart';

TurnClient createTurnClient({
  required String? rtcConfigUrl,
  required String origin,
  String? authToken,
}) => platform.createPlatformTurnClient(
  rtcConfigUrl: rtcConfigUrl,
  origin: origin,
  authToken: authToken,
);
