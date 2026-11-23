/// One open `reploid` data channel to another computer, seen as text frames.
///
/// The transport that made the connection supplies [binding]: the DTLS
/// certificate fingerprints of both ends (procedure `sdpFingerprint`). An
/// identity proof is valid only for the connection it names, so a link
/// without a binding can carry no request.
abstract interface class PeerLink {
  String get roomId;

  /// This device's connection name in the room. Not a signing identity.
  String get selfId;

  /// The other computer's connection name.
  String get peerId;

  ({String local, String remote})? get binding;

  bool get isOpen;

  /// Sends one text frame. Throws [StateError] when the link is closed or
  /// its send buffer is over the contract's limit.
  void send(String text);

  Stream<String> get texts;

  /// Completes when the link has closed, for any reason.
  Future<void> get closed;
}
