import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/canonical_json.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/codec.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/identity.dart';

void main() {
  test('matches the JavaScript modules on a first sample', () async {
    final expected =
        jsonDecode(File(Platform.environment['SMOKE']!).readAsStringSync())
            as Map<String, Object?>;
    final identity = await SigningIdentity.fromSeed(
      List.generate(32, (i) => i + 1),
    );
    expect(identity.publicJwk['x'], expected['x']);
    expect(identity.privateJwk['d'], expected['d']);
    expect(identity.peerId, expected['peerId']);
    final message = utf8Bytes('hello reploid');
    expect(toBase64Url(await identity.sign(message)), expected['sig']);
    expect(
      await verifySignature(
        identity.publicJwk,
        message,
        fromBase64Url(expected['sig']! as String),
      ),
      isTrue,
    );
    expect(canonicalJson(expected['tricky']), expected['canonical']);
    expect(hashJson(expected['tricky']), expected['hash']);
  });
}
