import 'peer_link.dart';
import 'requester_network.dart';
import 'signaling_config.dart';

final class _UnsupportedWebMeshTransport implements MeshTransport {
  @override
  TransportStatus get status => TransportStatus.offline;

  @override
  Stream<TransportStatus> get statusChanges => const Stream.empty();

  @override
  Stream<PeerLink> get links => const Stream.empty();

  @override
  Future<void> open() async => throw UnsupportedError(
    'Direct native signaling transport is unavailable in Flutter web builds.',
  );

  @override
  Future<void> close() async {}
}

MeshTransport createPlatformMeshTransport({
  required SignalingConfig config,
  void Function(String line)? trace,
}) => _UnsupportedWebMeshTransport();
