// The Dart requester against the web client's real provider code.
//
// tests/fixtures/requester-conformance/stdio-provider.js runs the JavaScript
// mesh's provider side with a stub model, speaking the data-channel protocol
// as JSON lines. Nothing here is recorded: every proof, admission, receipt and
// countersignature is checked by the real implementation on the other end.
// The test is skipped where Node or the installed modules are missing.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/contract.g.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_link.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_session.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_protocol.dart';

import 'support.dart';

const _provider =
    '$repositoryRoot/tests/fixtures/requester-conformance/stdio-provider.js';

String? _unavailable() {
  if (!File(_provider).existsSync()) return 'the provider fixture is missing';
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

final class _ProcessLink implements PeerLink {
  _ProcessLink(this._process, this.ready, Stream<String> lines) {
    _lines = lines.listen(_texts.add, onDone: _end);
  }

  final Process _process;
  final Json ready;
  late final StreamSubscription<String> _lines;
  final _texts = StreamController<String>();
  final _closed = Completer<void>();
  bool _open = true;

  Json get _requester => ready['requester']! as Json;
  Json get _providerSide => ready['provider']! as Json;

  @override
  String get roomId => ready['roomId']! as String;
  @override
  String get selfId => _requester['transportId']! as String;
  @override
  String get peerId => _providerSide['transportId']! as String;
  @override
  ({String local, String remote})? get binding => (
    local: _requester['fingerprint']! as String,
    remote: _providerSide['fingerprint']! as String,
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

Future<(_ProcessLink, PeerSession, CatalogRow)> _connect(
  SigningIdentity identity, [
  List<String> arguments = const [],
]) async {
  final process = await Process.start('node', [_provider, ...arguments]);
  unawaited(process.stderr.drain<void>());
  final lines = StreamIterator(
    process.stdout.transform(utf8.decoder).transform(const LineSplitter()),
  );
  expect(await lines.moveNext(), isTrue, reason: 'the provider prints a line');
  final ready = jsonDecode(lines.current) as Json;
  expect(ready['ready'], isTrue);
  final rest = StreamController<String>();
  unawaited(() async {
    while (await lines.moveNext()) {
      rest.add(lines.current);
    }
    await rest.close();
  }());
  final link = _ProcessLink(process, ready, rest.stream);
  final session = PeerSession(
    link: link,
    identity: identity,
    clock: LamportClock(),
  );
  final model = ready['model']! as Json;
  final row = CatalogRow(
    id: model['id']! as String,
    identity: model['identity']! as String,
    name: model['name']! as String,
  );
  for (var i = 0; i < 200 && session.advertisement == null; i++) {
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
  expect(session.advertisement?.selectable(row), isTrue);
  return (link, session, row);
}

/// Every event of a request, and the error that ended it, if any.
Future<(List<GenerationEvent>, Object?)> _collect(
  Stream<GenerationEvent> stream,
) {
  final events = <GenerationEvent>[];
  final done = Completer<(List<GenerationEvent>, Object?)>();
  stream.listen(
    events.add,
    onError: (Object error) => done.complete((events, error)),
    onDone: () {
      if (!done.isCompleted) done.complete((events, null));
    },
  );
  return done.future;
}

const _prompt = [
  <String, Object?>{
    'role': 'user',
    'content': 'What is the capital of France?',
  },
];

void main() {
  final skip = _unavailable();
  late SigningIdentity identity;
  setUpAll(() async => identity = await SigningIdentity.generate());

  test(
    'a full request: proof, admission, stream, receipt, countersign',
    () async {
      final (link, session, row) = await _connect(identity);
      final ready = link.ready;
      final answer = ready['answer']! as Json;
      for (var round = 0; round < 3; round++) {
        final events = await session
            .ask(model: row, messages: _prompt, contextId: 'thread-$round')
            .toList();
        final provider = ready['provider']! as Json;
        expect(events.first, isA<ProviderProven>());
        expect(
          (events.first as ProviderProven).participantId,
          provider['participantId'],
        );
        expect(events[1], isA<PromptDispatched>());
        final chunks = events
            .whereType<TextChunk>()
            .map((e) => e.text)
            .toList();
        expect(chunks, answer['chunks']);
        final completed = events.last as GenerationCompleted;
        expect(completed.content, answer['content']);
        expect(completed.receipt['consumer'], identity.peerId);
        expect(completed.receipt['provider'], provider['participantId']);
        expect(completed.receipt['consumerSignature'], isA<String>());
      }
      await session.close();
      await link.stop();
    },
    skip: skip,
  );

  test('a provider with an ECDSA P-256 identity is verified', () async {
    final (link, session, row) = await _connect(identity, [
      '--identity',
      'ecdsa',
    ]);
    final events = await session.ask(model: row, messages: _prompt).toList();
    final provider = link.ready['provider']! as Json;
    expect(provider['algorithm'], 'ECDSA');
    expect(
      (events.first as ProviderProven).participantId,
      provider['participantId'],
    );
    expect(events.last, isA<GenerationCompleted>());
    await session.close();
    await link.stop();
  }, skip: skip);

  test('a declined request never carries the prompt', () async {
    final (link, session, row) = await _connect(identity, ['--decline']);
    final (events, error) = await _collect(
      session.ask(model: row, messages: _prompt),
    );
    expect(events.whereType<ProviderProven>(), hasLength(1));
    expect(events.whereType<PromptDispatched>(), isEmpty);
    final failure = error! as ProtocolFailure;
    expect(failure.promptSent, isFalse);
    expect(failure.declined, isTrue);
    await session.close();
    await link.stop();
  }, skip: skip);

  test(
    'a provider failure mid-stream keeps the chunks and says sent',
    () async {
      final (link, session, row) = await _connect(identity, [
        '--fail-after-chunks',
        '1',
      ]);
      final (events, error) = await _collect(
        session.ask(model: row, messages: _prompt),
      );
      expect(events.whereType<TextChunk>(), hasLength(1));
      expect(events.whereType<GenerationCompleted>(), isEmpty);
      expect((error! as ProtocolFailure).promptSent, isTrue);
      await session.close();
      await link.stop();
    },
    skip: skip,
  );

  test(
    'stop cancels at the provider and the next request still works',
    () async {
      final (link, session, row) = await _connect(identity, [
        '--chunk-delay-ms',
        '250',
      ]);
      final firstChunk = Completer<void>();
      final subscription = session.ask(model: row, messages: _prompt).listen((
        event,
      ) {
        if (event is TextChunk && !firstChunk.isCompleted) {
          firstChunk.complete();
        }
      });
      await firstChunk.future;
      await subscription.cancel();
      // The provider frees its slot after the cancel; wait for it to say so.
      for (var i = 0; i < 200; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 25));
        if (session.advertisement?.selectable(row) ?? false) break;
      }
      final events = await session.ask(model: row, messages: _prompt).toList();
      expect(events.last, isA<GenerationCompleted>());
      await session.close();
      await link.stop();
    },
    skip: skip,
  );

  test(
    'a lost connection fails the request and reports the prompt as sent',
    () async {
      final (link, session, row) = await _connect(identity, [
        '--chunk-delay-ms',
        '250',
      ]);
      Object? error;
      final done = Completer<void>();
      session
          .ask(model: row, messages: _prompt)
          .listen(
            (event) {
              if (event is TextChunk) unawaited(link.stop());
            },
            onError: (Object e) => error = e,
            onDone: done.complete,
          );
      await done.future;
      final failure = error! as ProtocolFailure;
      expect(failure.promptSent, isTrue);
      expect(session.isClosed, isTrue);
      expect(session.advertisement, isNull);
    },
    skip: skip,
  );

  test('the generated constants match the contract file', () async {
    final result = await Process.run('dart', [
      'run',
      'tool/generate_contract.dart',
      '--check',
    ], workingDirectory: '..');
    expect(result.exitCode, 0, reason: '${result.stdout}${result.stderr}');
    expect(Contract.schema, 'reploid.requester-contract/v1');
  }, skip: skip);
}
