// The Dart protocol code against the requester contract's vectors. The
// vectors are produced by the web client's own modules, so agreement here
// means both clients compute the same bytes.
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/canonical_json.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/codec.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/contract.g.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/peer_session.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/requester_protocol.dart';

import 'support.dart';

void main() {
  test('canonical JSON and its digest, every case', () {
    final all = cases('canonicalJson');
    expect(all.length, greaterThanOrEqualTo(25));
    for (final c in all) {
      expect(canonicalJson(c['value']), c['canonical'], reason: '${c['name']}');
      expect(hashJson(c['value']), c['hashJson'], reason: '${c['name']}');
    }
  });

  test('a signed terminal verifies, and an altered one does not', () async {
    final section = vectors['generationTerminal']! as Json;
    final terminal = section['terminal']! as Json;
    final binding = section['binding']! as Json;
    final messages = (cases('promptCommitment').first['messages']! as List)
        .cast<Json>();
    Future<String?> check(Object? value, {String? provider}) => verifyTerminal(
      terminal: value,
      requestId: binding['requestId']! as String,
      modelId: binding['model']! as String,
      modelIdentity: binding['modelIdentity']! as String,
      messages: messages,
      provenProvider: provider ?? binding['provider']! as String,
      ownParticipantId: binding['consumer']! as String,
    );
    expect(hashJson(messages), binding['inputDigest']);
    expect(await check(terminal), terminal['status']);
    expect(await check({...terminal, 'status': 'cancelled'}), isNull);
    expect(await check({...terminal, 'settingsDigest': 'x'}), isNull);
    expect(
      await check(terminal, provider: 'peer:000000000000000000000000'),
      isNull,
    );
    expect(await check('not an object'), isNull);
  });

  test('participant ids from public keys', () {
    for (final key in cases('identity', 'keys')) {
      expect(
        peerIdFromPublicJwk(key['publicJwk']! as Json),
        key['peerId'],
        reason: '${key['name']}',
      );
    }
    for (final c in cases('identity', 'publicJwkAcceptance')) {
      final jwk = c['publicJwk']! as Json;
      expect(importablePublicJwk(jwk), c['importable'], reason: '${c['name']}');
      expect(peerIdFromPublicJwk(jwk), c['peerId'], reason: '${c['name']}');
    }
  });

  test('a stored key signs exactly as the web client does', () async {
    for (final c in cases('signatures')) {
      final message = utf8Bytes(c['messageUtf8']! as String);
      final signature = c['signatureBase64url']! as String;
      expect(
        await verifySignature(
          c['publicJwk']! as Json,
          message,
          _bytes(signature),
        ),
        c['valid'],
        reason: '${c['name']}',
      );
      if (c['deterministic'] == true) {
        final identity = await vectorIdentity(c['key']! as String);
        expect(
          toBase64Url(await identity.sign(message)),
          signature,
          reason: '${c['name']}',
        );
      }
    }
  });

  test('identity proofs: signed text and verification', () async {
    for (final c in cases('identityProof')) {
      final challenge = c['challenge']! as Json;
      // For a forged proof the vector records what the forger signed.
      if (c['signedBytesUtf8'] case final String text when c['valid'] == true) {
        expect(
          identityProofText(challenge, c['participantId']! as String),
          text,
          reason: '${c['name']}',
        );
      }
      final reason = c['reason'] as String?;
      if (reason != null && reason.startsWith('Ignored')) continue;
      final verify = verifyIdentityProof(challenge, c['proof']! as Json);
      if (c['valid'] == true) {
        expect(await verify, c['participantId'], reason: '${c['name']}');
      } else {
        await expectLater(
          verify,
          throwsA(
            isA<ProtocolFailure>().having((f) => f.message, 'message', reason),
          ),
          reason: '${c['name']}',
        );
      }
    }
  });

  test('a challenge is answered only on the connection it names', () async {
    final identity = await vectorIdentity('providerEd25519');
    for (final c in cases('identityProof', 'answerCases')) {
      final binding = c['answererBinding']! as Json;
      final link = FakeLink(
        roomId: c['answererRoomId']! as String,
        selfId: c['answererConnectionName']! as String,
        peerId: c['arrivedOnConnection']! as String,
        binding: (
          local: binding['local']! as String,
          remote: binding['remote']! as String,
        ),
      );
      final session = PeerSession(
        link: link,
        identity: identity,
        clock: LamportClock(),
      );
      link.deliverPayload(
        ChannelType.identityChallenge,
        c['challenge']! as Json,
      );
      await settle();
      final proofs = link.sentOf(ChannelType.identityProof);
      expect(
        proofs.length,
        c['answered'] == true ? 1 : 0,
        reason: '${c['name']}',
      );
      if (c['proof'] case final Json expected) {
        expect(proofs.single['signature'], expected['signature']);
        expect(proofs.single['participantId'], expected['participantId']);
        expect(proofs.single['nonce'], expected['nonce']);
      }
      await session.close();
    }
  });

  test('certificate fingerprints from session descriptions', () {
    for (final c in cases('sdpFingerprint')) {
      expect(
        sdpFingerprint(c['sdp'] as String?),
        c['fingerprint'],
        reason: '${c['name']}',
      );
    }
  });

  test('prompt commitments', () {
    for (final c in cases('promptCommitment')) {
      if (c['settings'] != null) continue; // settings are not covered
      expect(
        promptCommitment(
          c['salt']! as String,
          (c['messages']! as List).cast<Json>(),
        ),
        c['commitment'],
        reason: '${c['name']}',
      );
    }
  });

  test('privacy policy, route and binding', () {
    for (final c in cases('privacyBinding')) {
      if ((c['adapterIdentities']! as List).isNotEmpty) continue;
      final privacy = c['privacy']! as Json;
      final recipients = privacy['recipients']! as Json;
      if (recipients['kind'] != 'open') {
        continue; // named recipients are not covered
      }
      final route = executionRoute(
        modelId: c['modelId']! as String,
        modelIdentity: c['modelIdentity']! as String,
        providerId: c['providerParticipantId']! as String,
        offer: {
          'id': Contract.generationOfferId,
          'backend': Contract.generationBackend,
        },
      );
      expect(canonicalJson(privacyPolicy()), c['policyCanonical']);
      expect(canonicalJson(route), c['routeCanonical'], reason: '${c['name']}');
      expect(
        canonicalJson(privacyBinding(privacyPolicy(), route)),
        canonicalJson(c['binding']),
        reason: '${c['name']}',
      );
    }
  });

  test('the admit frame is the request without the prompt', () {
    for (final c in cases('admit')) {
      final request = c['request']! as Json;
      final expected = c['admitPayload']! as Json;
      final admission = request['admission']! as Json;
      if (request['settings'] != null) continue;
      final commitment = promptCommitment(
        admission['salt']! as String,
        (request['messages']! as List).cast<Json>(),
      );
      final admit = admitPayload(request, commitment);
      expect(
        canonicalJson(admit),
        canonicalJson(expected),
        reason: '${c['name']}',
      );
      expect(admit.containsKey('messages'), isFalse);
      expect(admit.containsKey('admission'), isFalse);
    }
  });

  group('receipts', () {
    Future<Json> check(Json c, {int? early}) {
      final response = Map<String, Object?>.of(c['response']! as Json);
      return verifyResult(
        requestId: c['requestId']! as String,
        modelId: 'qwen-3-5-2b-q4k-ef16-af32',
        modelIdentity: 'sha256:eb2a48400c975389a4ed8a166228cdc0feeca8c56bc85f36604e26c18e303541',
        messages: (c['messages']! as List).cast<Json>(),
        provenProvider: c['provenProviderId']! as String,
        ownParticipantId: c['consumer']! as String,
        earlyInputTokens: early,
        response: response,
        receipt: c['receipt'],
      );
    }

    test('a valid receipt verifies and yields the signed payload', () async {
      for (final c in cases('receipt', 'valid')) {
        final payload = await check(c);
        expect(
          canonicalJson(payload),
          c['payloadCanonical'],
          reason: '${c['name']}',
        );
        expect(payload.keys.toList(), Contract.receiptSignedFields);
      }
    });

    test('every tampered or misbound receipt is refused', () async {
      const known = {
        'Measured receipt differs from the admitted request or provider output',
        'Remote receipt is invalid or does not bind this request',
        'Provider input token count differs from its early observation',
        'Remote response substituted the requested model',
        'Receipt does not bind the generation settings of this request',
      };
      final all = cases('receipt', 'invalid');
      expect(all.length, greaterThanOrEqualTo(10));
      for (final c in all) {
        final reason = c['reason']! as String;
        await expectLater(
          check(c, early: c['earlyInputTokens'] as int?),
          throwsA(
            isA<ProtocolFailure>().having(
              (f) => known.contains(reason) ? f.message : reason,
              'message',
              reason,
            ),
          ),
          reason: '${c['name']}',
        );
      }
    });

    test(
      'a result with no receipt is refused, unlike the web client',
      () async {
        final valid = cases('receipt', 'valid').first;
        await expectLater(
          check({...valid, 'receipt': null}),
          throwsA(isA<ProtocolFailure>()),
        );
      },
    );

    test('the countersignature matches the web client byte for byte', () async {
      final valid = cases('receipt', 'valid').first;
      final expected = cases('receipt', 'countersigned').first;
      final identity = await vectorIdentity(
        expected['consumerKeyName']! as String,
      );
      final payload = await check(valid);
      final receipt = await countersign(
        payload,
        valid['receipt']! as Json,
        identity,
      );
      final theirs = expected['receipt']! as Json;
      expect(receipt.keys.toList(), expected['memberOrder']);
      expect(receipt['consumerSignature'], theirs['consumerSignature']);
      expect(receipt['providerSignature'], theirs['providerSignature']);
      expect(
        peerIdFromPublicJwk(receipt['consumerKey']! as Json),
        peerIdFromPublicJwk(theirs['consumerKey']! as Json),
      );
      for (final field in Contract.receiptSignedFields) {
        expect(canonicalJson(receipt[field]), canonicalJson(theirs[field]));
      }
    });
  });

  test('envelopes: accepted and dropped frames', () {
    final section = vectors['envelope']! as Json;
    final from = section['receivedFrom']! as String;
    for (final c in cases('envelope')) {
      final frame = c['frame'];
      final text = frame is String
          ? frame
          : 'x' * ((c['frameLength'] as int?) ?? 0);
      expect(
        acceptEnvelope(text, from: from) != null,
        c['valid'],
        reason: '${c['name']}',
      );
    }
  });

  test('which computers count as ready, busy or unusable', () {
    final section = vectors['readyPeer']! as Json;
    final catalog = section['catalogRow']! as Json;
    final row = CatalogRow(
      id: catalog['id']! as String,
      identity: catalog['identity']! as String,
      name: catalog['name']! as String,
    );
    for (final c in cases('readyPeer')) {
      final connection = c['connection']! as Json;
      final result = c['result']! as Json;
      final stored = Advertisement.accept(c['advertisement']);
      expect(stored != null, c['stored'], reason: '${c['name']}: stored');
      // Whether the connection can carry a request is the transport's fact.
      final reachable =
          connection['channelState'] == 'open' &&
          !const {
            'disconnected',
            'failed',
            'closed',
          }.contains(connection['iceState']) &&
          connection['attemptId'] != 'an-earlier-attempt';
      final usable = [if (stored != null && reachable) stored];
      expect(
        rowAvailability(row, usable),
        result['availability'],
        reason: '${c['name']}',
      );
      expect(
        usable.any((a) => a.selectable(row)),
        result['selectableForRequest'],
        reason: '${c['name']}: selectable',
      );
      if (stored != null) {
        expect(
          stored.eligibleOffers(row.identity).map((o) => o['id']).toList(),
          result['eligibleOfferIds'],
          reason: '${c['name']}: offers',
        );
      }
    }
  });
}

List<int> _bytes(String text) {
  try {
    return fromBase64Url(text);
  } on FormatException {
    return const [];
  }
}
