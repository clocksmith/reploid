import 'package:core/core.dart';

import '../../../l10n/strings.dart';
import '../domain/chat.dart';

/// Values from another session are never rendered, even for one frame.
T? ownSession<T>(T? value, SessionKey Function(T) key, SessionHandle session) =>
    value != null && key(value) == session.key ? value : null;

String networkLabel(NetworkStatus status) => switch (status) {
  NetworkStatus.online => Strings.online,
  NetworkStatus.connecting => Strings.connecting,
  NetworkStatus.offline => Strings.offline,
};

String modelDisplayName(List<ModelOption> models, String modelId) =>
    models.where((m) => m.id == modelId).firstOrNull?.name ?? modelId;
