// Owner pairing: the contract's vectors, then the real desktop-side code.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/contract.g.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/pairing.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_session.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_network.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_protocol.dart';

import 'provider_process.dart';
import 'support.dart';

Json get _pairing => vectors['pairing']! as Json;

List<Json> _part(String name, [String list = 'cases']) =>
    ((_pairing[name]! as Json)[list]! as List).cast<Json>();

Future<(RequesterNetwork, ProcessTransport, Json, CatalogRow)> _desk(
  List<String> arguments,
) async {
  final transport = ProcessTransport(['--pairing', ...arguments]);
  final network = RequesterNetwork(
    transport: transport,
    identity: await SigningIdentity.generate(),
    discoveryTimeout: const Duration(seconds: 5),
  );
  await network.open();
  final ready = transport.link!.ready;
  final model = ready['model']! as Json;
  return (
    network,
    transport,
    ready['pairing']! as Json,
    CatalogRow(
      id: model['id']! as String,
      identity: model['identity']! as String,
      name: model['name']! as String,
    ),
  );
}

const _prompt = [
  <String, Object?>{
    'role': 'user',
    'content': 'What is the capital of France?',
  },
];

Future<(List<GenerationEvent>, ProtocolFailure?)> _ask(
  RequesterNetwork network,
  CatalogRow model,
  String desktop,
) async {
  final events = <GenerationEvent>[];
  ProtocolFailure? failure;
  await for (final event
      in network
          .ask(model: model, messages: _prompt, namedRecipient: desktop)
          .handleError((Object e) => failure = e as ProtocolFailure)) {
    events.add(event);
  }
  return (events, failure);
}

void main() {
  test('pairing links: every case of the contract', () {
    final all = _part('link');
    expect(all.length, greaterThanOrEqualTo(30));
    for (final c in all) {
      final parsed = PairingLink.parse(c['url']! as String);
      final expected = c['parsed'] as Json?;
      expect(parsed == null, expected == null, reason: '${c['name']}');
      if (parsed == null || expected == null) continue;
      expect(
        {
          'code': parsed.code,
          'hostParticipantId': parsed.hostParticipantId,
          'hostLabel': ?parsed.hostLabel,
          'roomId': ?parsed.roomId,
        },
        expected,
        reason: '${c['name']}',
      );
    }
  });

  test('the pairing room marker', () {
    for (final c in _part('roomToken')) {
      final room = c['roomId'];
      if (room is! String || c['error'] != null) continue;
      expect(pairingRoomToken(room), c['token']);
    }
    expect(
      pairingRoomToken('reploid-swarm-my-desk'),
      startsWith(Contract.pairingRoomTokenPrefix),
    );
  });

  test('stored pairing records: accepted and refused', () {
    for (final c in _part('storedRecord')) {
      final stored = c['stored'];
      final state = c['state']! as Json;
      Object? decoded = stored;
      if (stored is String) {
        try {
          decoded = jsonDecode(stored);
        } on FormatException {
          decoded = null;
        }
      }
      final record = PairingRecord.fromJson(decoded);
      expect(record != null, state['paired'], reason: '${c['name']}');
      if (record != null) {
        expect(record.hostParticipantId, state['hostParticipantId']);
        expect(record.hostLabel, state['hostLabel']);
        expect(record.roomId, state['roomId']);
        expect(record.pairedAt, state['pairedAt'], reason: '${c['name']}');
      }
    }
  });

  final skip = providerUnavailable();

  test(
    'unpaired is refused, pairing works, then only the desktop answers',
    () async {
      final (network, transport, pairing, model) = await _desk(const []);
      final link = PairingLink.parse(pairing['link']! as String)!;
      final desktop = pairing['hostParticipantId']! as String;
      expect(link.hostParticipantId, desktop);
      expect(link.code, pairing['code']);
      expect(link.hostLabel, pairing['hostLabel']);

      // Before pairing the desktop refuses, and the prompt stays here.
      var (events, failure) = await _ask(network, model, desktop);
      expect(events.whereType<PromptDispatched>(), isEmpty);
      expect(failure!.declined, isTrue);
      expect(failure.promptSent, isFalse);

      var asked = false;
      expect(
        await network.pair(
          code: link.code,
          hostParticipantId: desktop,
          onAsked: () => asked = true,
        ),
        isTrue,
      );
      expect(asked, isTrue);
      expect(network.proven(desktop), isNotNull);

      for (var round = 0; round < 2; round++) {
        (events, failure) = await _ask(network, model, desktop);
        expect(failure, isNull);
        expect((events.first as ProviderProven).participantId, desktop);
        final completed = events.last as GenerationCompleted;
        expect(
          completed.content,
          (transport.link!.ready['answer']! as Json)['content'],
        );
      }

      // The code was single use: a second try gets no answer at all.
      await expectLater(
        network.pair(
          code: link.code,
          hostParticipantId: desktop,
          wait: const Duration(milliseconds: 700),
        ),
        throwsA(isA<ProtocolFailure>()),
      );
      await network.close();
    },
    skip: skip,
  );

  test('an expired code gets no answer and pairs nothing', () async {
    final (network, _, pairing, model) = await _desk(['--pairing-expired']);
    final desktop = pairing['hostParticipantId']! as String;
    await expectLater(
      network.pair(
        code: pairing['code']! as String,
        hostParticipantId: desktop,
        wait: const Duration(milliseconds: 700),
      ),
      throwsA(isA<ProtocolFailure>()),
    );
    final (events, failure) = await _ask(network, model, desktop);
    expect(events.whereType<PromptDispatched>(), isEmpty);
    expect(failure!.promptSent, isFalse);
    await network.close();
  }, skip: skip);

  test('an owner who declines leaves the phone unpaired', () async {
    final (network, _, pairing, model) = await _desk(['--pairing-decline']);
    final desktop = pairing['hostParticipantId']! as String;
    expect(
      await network.pair(
        code: pairing['code']! as String,
        hostParticipantId: desktop,
      ),
      isFalse,
    );
    final (events, failure) = await _ask(network, model, desktop);
    expect(events.whereType<PromptDispatched>(), isEmpty);
    expect(failure!.declined, isTrue);
    await network.close();
  }, skip: skip);

  test('a desktop that dropped the phone refuses before the prompt', () async {
    final (network, _, pairing, model) = await _desk([
      '--pairing-forget-after-requests',
      '1',
    ]);
    final desktop = pairing['hostParticipantId']! as String;
    expect(
      await network.pair(
        code: pairing['code']! as String,
        hostParticipantId: desktop,
      ),
      isTrue,
    );
    var (events, failure) = await _ask(network, model, desktop);
    expect(events.last, isA<GenerationCompleted>());
    (events, failure) = await _ask(network, model, desktop);
    expect(events.whereType<PromptDispatched>(), isEmpty);
    expect(failure!.declined, isTrue);
    expect(failure.promptSent, isFalse);
    // It is still the same, proven desktop: this is "pair again", not offline.
    expect(network.proven(desktop), isNotNull);
    await network.close();
  }, skip: skip);

  test('a request for a desktop that is not there sends nothing', () async {
    final network = RequesterNetwork(
      transport: _Idle(),
      identity: await SigningIdentity.generate(),
      discoveryTimeout: const Duration(milliseconds: 300),
    );
    final (events, failure) = await _ask(
      network,
      modelCatalog.first,
      'peer:ffffffffffffffffffffffff',
    );
    expect(events, isEmpty);
    expect(failure!.message, 'No remote host slot available');
    expect(failure.promptSent, isFalse);
    await network.close();
  });

  test('a computer that is not the named desktop is never used', () async {
    // The provider is real and ready, but it is not the identity asked for.
    final transport = ProcessTransport();
    final network = RequesterNetwork(
      transport: transport,
      identity: await SigningIdentity.generate(),
      discoveryTimeout: const Duration(milliseconds: 1500),
    );
    await network.open();
    final model = transport.link!.ready['model']! as Json;
    final row = CatalogRow(
      id: model['id']! as String,
      identity: model['identity']! as String,
      name: model['name']! as String,
    );
    final (events, failure) = await _ask(
      network,
      row,
      'peer:ffffffffffffffffffffffff',
    );
    expect(events, isEmpty, reason: 'no recipient is ever substituted');
    expect(failure!.promptSent, isFalse);
    // The same computer answers when it is the one asked for by nobody.
    final open = await network.ask(model: row, messages: _prompt).toList();
    expect(open.last, isA<GenerationCompleted>());
    await network.close();
  }, skip: skip);
}

final class _Idle implements MeshTransport {
  @override
  TransportStatus get status => TransportStatus.online;
  @override
  Stream<TransportStatus> get statusChanges => const Stream.empty();
  @override
  Stream<Never> get links => const Stream.empty();
  @override
  Future<void> open() async {}
  @override
  Future<void> close() async {}
}
