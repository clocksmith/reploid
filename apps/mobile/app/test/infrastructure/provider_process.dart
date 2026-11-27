import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:reploid_mobile/infrastructure/reploid_api/peer_link.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_network.dart';

import 'support.dart';

const providerScript =
    '$repositoryRoot/tests/fixtures/requester-conformance/stdio-provider.js';

/// Why the web client's provider code cannot run here, or null when it can.
String? providerUnavailable() {
  if (!File(providerScript).existsSync()) {
    return 'the provider fixture is missing';
  }
  if (!Directory('$repositoryRoot/node_modules').existsSync()) {
    return 'node_modules is not installed at the repository root';
  }
  try {
    if (Process.runSync('node', ['--version']).exitCode != 0) {
      return 'node is not runnable';
    }
  } on ProcessException {
    return 'node is not on PATH';
  }
  return null;
}

/// The data channel to the provider process: one envelope per line.
final class ProcessLink implements PeerLink {
  ProcessLink._(this._process, this.ready, Stream<String> lines) {
    _lines = lines.listen(_texts.add, onDone: _end);
  }

  static Future<ProcessLink> start([List<String> arguments = const []]) async {
    final process = await Process.start('node', [providerScript, ...arguments]);
    unawaited(process.stderr.drain<void>());
    final lines = StreamIterator(
      process.stdout.transform(utf8.decoder).transform(const LineSplitter()),
    );
    if (!await lines.moveNext()) throw StateError('The provider did not start');
    final ready = jsonDecode(lines.current) as Json;
    final rest = StreamController<String>();
    unawaited(() async {
      while (await lines.moveNext()) {
        rest.add(lines.current);
      }
      await rest.close();
    }());
    return ProcessLink._(process, ready, rest.stream);
  }

  final Process _process;

  /// The provider's first line: its names, fingerprints, model and answer.
  final Json ready;
  late final StreamSubscription<String> _lines;
  final _texts = StreamController<String>();
  final _closed = Completer<void>();
  bool _open = true;

  Json get _requester => ready['requester']! as Json;
  Json get provider => ready['provider']! as Json;

  @override
  String get roomId => ready['roomId']! as String;
  @override
  String get selfId => _requester['transportId']! as String;
  @override
  String get peerId => provider['transportId']! as String;
  @override
  ({String local, String remote})? get binding => (
    local: _requester['fingerprint']! as String,
    remote: provider['fingerprint']! as String,
  );
  @override
  bool get isOpen => _open;

  @override
  void send(String text) {
    if (!_open) throw StateError('closed');
    _process.stdin.writeln(text);
  }

  @override
  Stream<String> get texts => _texts.stream;
  @override
  Future<void> get closed => _closed.future;

  void _end() {
    _open = false;
    if (!_closed.isCompleted) _closed.complete();
  }

  Future<void> stop() async {
    _end();
    _process.kill();
    await _lines.cancel();
    await _process.exitCode;
  }
}

/// A transport with exactly one connection: the provider process.
base class ProcessTransport implements MeshTransport {
  ProcessTransport([this.arguments = const []]);
  final List<String> arguments;
  final _links = StreamController<PeerLink>();
  final _status = StreamController<TransportStatus>.broadcast();
  ProcessLink? link;

  @override
  TransportStatus status = TransportStatus.offline;
  @override
  Stream<TransportStatus> get statusChanges => _status.stream;
  @override
  Stream<PeerLink> get links => _links.stream;

  void _set(TransportStatus next) {
    status = next;
    _status.add(next);
  }

  @override
  Future<void> open() async {
    if (link != null) return;
    _set(TransportStatus.connecting);
    final started = link = await ProcessLink.start(arguments);
    _set(TransportStatus.online);
    _links.add(started);
  }

  @override
  Future<void> close() async {
    await link?.stop();
    if (_status.isClosed) return;
    _set(TransportStatus.offline);
    await _links.close();
    await _status.close();
  }
}
