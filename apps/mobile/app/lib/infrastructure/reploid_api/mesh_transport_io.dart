import 'requester_network.dart';
import 'webrtc_transport.dart';

MeshTransport createPlatformMeshTransport({
  required SignalingConfig config,
  void Function(String line)? trace,
}) => WebRtcMeshTransport(config: config, trace: trace);
