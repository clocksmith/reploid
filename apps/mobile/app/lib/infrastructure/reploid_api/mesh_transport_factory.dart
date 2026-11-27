import 'mesh_transport_web.dart'
    if (dart.library.io) 'mesh_transport_io.dart'
    as platform;
import 'requester_network.dart';
import 'signaling_config.dart';

export 'signaling_config.dart';

MeshTransport createMeshTransport({
  required SignalingConfig config,
  void Function(String line)? trace,
}) => platform.createPlatformMeshTransport(config: config, trace: trace);
