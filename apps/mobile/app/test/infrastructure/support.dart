import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:reploid_mobile/infrastructure/reploid_api/codec.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_link.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_session.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_protocol.dart';

export 'package:reploid_mobile/infrastructure/reploid_api/requester_protocol.dart'
    show Json;

/// The repository root, from the app directory where `flutter test` runs.
const repositoryRoot = '../../..';

/// The contract's vectors, generated from the web client's own modules.
final Json vectors = jsonDecode(
  File('$repositoryRoot/tests/fixtures/requester-conformance/vectors.json')
      .readAsStringSync(),
) as Json;

List<Json> cases(String section, [String list = 'cases']) =>
    ((vectors[section]! as Json)[list]! as List).cast<Json>();

/// A fixed key of the vectors, as a signing identity.
Future<SigningIdentity> vectorIdentity(String name) async {
  final key = cases('identity', 'keys').firstWhere((k) => k['name'] == name);
  final private = key['privateJwk']! as Json;
  return SigningIdentity.fromSeed(fromBase64Url(private['d']! as String));
}

/// A link whose other end is the test.
final class FakeLink implements PeerLink {
  FakeLink({
    required this.roomId,
    required this.selfId,
    required this.peerId,
    this.binding,
  });

  @override
  final String roomId;
  @override
  final String selfId;
  @override
  final String peerId;
  @override
  ({String local, String remote})? binding;

  final _incoming = StreamController<String>();
  final _closed = Completer<void>();
  final List<Json> sent = [];
  final _sentEvents = StreamController<Json>.broadcast();
  bool open = true;

  @override
  bool get isOpen => open;

  @override
  void send(String text) {
    if (!open) throw StateError('closed');
    final envelope = jsonDecode(text) as Json;
    sent.add(envelope);
    _sentEvents.add(envelope);
  }

  @override
  Stream<String> get texts => _incoming.stream;

  @override
  Future<void> get closed => _closed.future;

  /// Delivers a frame as if the other computer had sent it.
  void deliver(Object envelope) =>
      _incoming.add(envelope is String ? envelope : jsonEncode(envelope));

  void deliverPayload(String type, Json payload, {int timestamp = 1}) =>
      deliver({
        'protocolVersion': 1,
        'type': type,
        'peerId': peerId,
        'timestamp': timestamp,
        'payload': payload,
        'payloadSize': jsonEncode(payload).length,
      });

  Future<Json> nextSent(String type) =>
      _sentEvents.stream.firstWhere((envelope) => envelope['type'] == type);

  List<Json> sentOf(String type) => [
    for (final envelope in sent)
      if (envelope['type'] == type) envelope['payload']! as Json,
  ];

  void disconnect() {
    open = false;
    if (!_closed.isCompleted) _closed.complete();
  }
}

/// Fresh values in a fixed order, as the vectors record them.
final class ScriptedEntropy implements Entropy {
  ScriptedEntropy({required this.uuids, required this.salts});
  final List<String> uuids;
  final List<String> salts;

  @override
  String uuid() => uuids.removeAt(0);

  @override
  String salt() => salts.removeAt(0);
}

Future<void> settle() => Future<void>.delayed(const Duration(milliseconds: 20));
