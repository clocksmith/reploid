// Procedures `requestDelivery` and `identityProofVerification` on the
// requester side: request frames carry delivery, an unacknowledged frame is
// sent again to the same connection a bounded number of times, and a proof
// made on this connection is reused by the next request.

import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/canonical_json.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/codec.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/contract.g.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_session.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_protocol.dart';

import 'support.dart';

/// The real provider's first advertisement in the transcript.
Json _advertisement() {
  final frames = ((vectors['transcript']! as Json)['frames']! as List)
      .cast<Json>();
  final first = frames.firstWhere(
    (f) =>
        f['direction'] == 'provider->requester' &&
        (f['envelope']! as Json)['type'] == ChannelType.peerAdvertisement,
  );
  return Map.of((first['envelope']! as Json)['payload']! as Json);
}

void main() {
  late SigningIdentity provider;
  late SigningIdentity requester;
  setUpAll(() async {
    provider = await vectorIdentity('providerEd25519');
    requester = await SigningIdentity.generate();
  });

  final row = modelCatalog.firstWhere(
    (r) => r.identity == _advertisement()['modelIdentity'],
  );

  Future<(FakeLink, PeerSession)> connect(Json advertisement) async {
    final link = FakeLink(
      roomId: 'reploid-swarm-delivery',
      selfId: 'requester-connection',
      peerId: 'provider-connection',
      binding: (local: 'sha-256 AA', remote: 'sha-256 BB'),
    );
    final session = PeerSession(
      link: link,
      identity: requester,
      clock: LamportClock(),
      deliveryAckTimeout: const Duration(milliseconds: 40),
    );
    link.deliverPayload(ChannelType.peerAdvertisement, advertisement);
    await settle();
    return (link, session);
  }

  // Answers each identity challenge as the provider would.
  void proveOnChallenge(FakeLink link) {
    link.nextSent(ChannelType.identityChallenge).then((envelope) async {
      final challenge = envelope['payload']! as Json;
      final signature = await provider.sign(
        utf8Bytes(identityProofText(challenge, provider.peerId)),
      );
      link.deliverPayload(ChannelType.identityProof, {
        'nonce': challenge['nonce'],
        'participantId': provider.peerId,
        'publicJwk': provider.publicJwk,
        'signature': toBase64Url(signature),
      });
    });
  }

  test('an unacknowledged frame is re-sent to the same connection, at most '
      'maxRequestResends times, and an acknowledgement stops it', () async {
    final (link, session) = await connect(_advertisement());
    proveOnChallenge(link);
    final events = <GenerationEvent>[];
    final subscription = session
        .ask(
          model: row,
          messages: const [
            {'role': 'user', 'content': 'hello'},
          ],
        )
        .listen(events.add, onError: (_) {});
    await link.nextSent(ChannelType.generationAdmit);
    // Nothing acknowledges the admission: the same frame comes again.
    await Future<void>.delayed(const Duration(milliseconds: 200));
    final admits = link.sentOf(ChannelType.generationAdmit);
    expect(admits.map((p) => p['delivery']).toList(), [
      for (
        var attempt = 1;
        attempt <= 1 + Contract.generationMaxRequestResends;
        attempt++
      )
        {'protocol': Contract.generationDeliveryProtocol, 'attempt': attempt},
    ]);
    expect(admits.first.keys.last, 'delivery');
    final withoutDelivery = [
      for (final p in admits) {...p}..remove('delivery'),
    ];
    // The same frame each time, apart from its attempt.
    expect(withoutDelivery.map(canonicalJson).toSet(), hasLength(1));

    final admit = admits.first;
    link.deliverPayload(ChannelType.generationAdmitted, {
      'requestId': admit['requestId'],
      'admissionProtocol': Contract.generationAdmissionProtocol,
      'promptCommitment': admit['promptCommitment'],
    });
    final request =
        (await link.nextSent(ChannelType.generationRequest))['payload']!
            as Json;
    expect(request['delivery'], {
      'protocol': Contract.generationDeliveryProtocol,
      'attempt': 1,
    });
    link.deliverPayload(ChannelType.requestReceived, {
      'requestId': request['requestId'],
      'stage': 'request',
      'attempt': 1,
    });
    await Future<void>.delayed(const Duration(milliseconds: 150));
    expect(link.sentOf(ChannelType.generationRequest), hasLength(1));
    expect(events.whereType<PromptDispatched>(), hasLength(1));
    await subscription.cancel();
    await session.close();
  });

  test('a provider without deliveryProtocol gets no delivery and no repeat, '
      'and the next request reuses the proof of this connection', () async {
    final advertisement = _advertisement()
      ..remove('deliveryProtocol')
      ..remove('deliveryProtocols');
    final (link, session) = await connect(advertisement);
    proveOnChallenge(link);
    for (var round = 0; round < 2; round++) {
      final subscription = session
          .ask(
            model: row,
            messages: const [
              {'role': 'user', 'content': 'hello'},
            ],
          )
          .listen((_) {}, onError: (_) {});
      await Future<void>.delayed(const Duration(milliseconds: 150));
      await subscription.cancel();
      await settle();
    }
    final admits = link.sentOf(ChannelType.generationAdmit);
    expect(admits, hasLength(2));
    expect(admits.every((p) => !p.containsKey('delivery')), isTrue);
    expect(link.sentOf(ChannelType.identityChallenge), hasLength(1));
    await session.close();
  });

  test('a changed binding needs a new proof', () async {
    final (link, session) = await connect(_advertisement());
    proveOnChallenge(link);
    expect(await session.provenProvider(), provider.peerId);
    expect(session.currentProof, provider.peerId);
    link.binding = (local: 'sha-256 CC', remote: 'sha-256 BB');
    expect(session.currentProof, isNull);
    proveOnChallenge(link);
    expect(await session.provenProvider(), provider.peerId);
    expect(link.sentOf(ChannelType.identityChallenge), hasLength(2));
    await session.close();
  });
}
