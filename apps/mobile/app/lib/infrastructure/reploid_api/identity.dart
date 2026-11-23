/// Signing identities of the requester contract: an Ed25519 key pair held on
/// this device, and verification of the two algorithms a provider may use.
library;

import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart' as c;
import 'package:pointycastle/api.dart' show PublicKeyParameter;
import 'package:pointycastle/digests/sha256.dart';
import 'package:pointycastle/ecc/api.dart';
import 'package:pointycastle/ecc/curves/secp256r1.dart';
import 'package:pointycastle/signers/ecdsa_signer.dart';

import 'canonical_json.dart';
import 'codec.dart';

typedef Jwk = Map<String, Object?>;

/// Procedure `peerIdFromPublicJwk`.
String peerIdFromPublicJwk(Jwk publicJwk) {
  String? field(String name) {
    final value = publicJwk[name];
    return value is String && value.isNotEmpty ? value : null;
  }

  final shape = {
    for (final name in const ['kty', 'crv', 'x', 'y', 'n', 'e'])
      name: field(name),
  };
  return 'peer:${hex(sha256(utf8Bytes(canonicalJson(shape)))).substring(0, 24)}';
}

bool _isEd25519(Jwk publicJwk) => publicJwk['crv'] == 'Ed25519';

/// Whether the web platform would import [jwk] as a verification key. A key
/// it would refuse proves nothing here either, so both clients agree on
/// which computers have a usable identity.
bool importablePublicJwk(Jwk jwk) {
  final ed = _isEd25519(jwk);
  final ops = jwk['key_ops'];
  bool text(String name) => jwk[name] is String;
  return !jwk.containsKey('d') &&
      (jwk['use'] == null || jwk['use'] == 'sig') &&
      (ops == null || (ops is List && ops.contains('verify'))) &&
      (ed
          ? jwk['kty'] == 'OKP' &&
                text('x') &&
                const {null, 'Ed25519', 'EdDSA'}.contains(jwk['alg'])
          : jwk['kty'] == 'EC' &&
                jwk['crv'] == 'P-256' &&
                text('x') &&
                text('y') &&
                const {null, 'ES256'}.contains(jwk['alg']));
}

/// True only for a well-formed signature by the key in [publicJwk].
/// Ed25519, or ECDSA P-256 with SHA-256 and a raw `r || s` signature.
Future<bool> verifySignature(
  Jwk publicJwk,
  List<int> message,
  List<int> signature,
) async {
  try {
    if (!importablePublicJwk(publicJwk)) return false;
    if (_isEd25519(publicJwk)) {
      final key = fromBase64Url(publicJwk['x']! as String);
      if (key.length != 32 || signature.length != 64) return false;
      return await c.Ed25519().verify(
        message,
        signature: c.Signature(
          signature,
          publicKey: c.SimplePublicKey(key, type: c.KeyPairType.ed25519),
        ),
      );
    }
    if (signature.length != 64) return false;
    final curve = ECCurve_secp256r1();
    final point = curve.curve.createPoint(
      _bigInt(fromBase64Url(publicJwk['x']! as String)),
      _bigInt(fromBase64Url(publicJwk['y']! as String)),
    );
    final signer = ECDSASigner(SHA256Digest())
      ..init(false, PublicKeyParameter<ECPublicKey>(ECPublicKey(point, curve)));
    return signer.verifySignature(
      Uint8List.fromList(message),
      ECSignature(
        _bigInt(signature.sublist(0, 32)),
        _bigInt(signature.sublist(32)),
      ),
    );
  } catch (_) {
    return false; // malformed key or signature
  }
}

BigInt _bigInt(List<int> bytes) =>
    bytes.fold(BigInt.zero, (value, byte) => (value << 8) | BigInt.from(byte));

/// Object `identityBundle`. The private JWK never leaves this device.
final class SigningIdentity {
  SigningIdentity._(this.peerId, this.publicJwk, this.privateJwk, this._pair);

  final String peerId;
  final Jwk publicJwk;
  final Jwk privateJwk;
  final c.SimpleKeyPair _pair;

  static const algorithm = 'Ed25519';

  static Future<SigningIdentity> generate([Random? random]) {
    final source = random ?? Random.secure();
    return fromSeed(List<int>.generate(32, (_) => source.nextInt(256)));
  }

  static Future<SigningIdentity> fromSeed(List<int> seed) async {
    if (seed.length != 32) throw ArgumentError('An Ed25519 seed is 32 bytes');
    final pair = await c.Ed25519().newKeyPairFromSeed(seed);
    final public = await pair.extractPublicKey();
    final x = toBase64Url(public.bytes);
    final publicJwk = <String, Object?>{'crv': 'Ed25519', 'kty': 'OKP', 'x': x};
    return SigningIdentity._(
      peerIdFromPublicJwk(publicJwk),
      Map.unmodifiable(publicJwk),
      Map.unmodifiable({...publicJwk, 'd': toBase64Url(seed)}),
      pair,
    );
  }

  /// Restores a stored bundle; rejects one whose parts do not belong together.
  static Future<SigningIdentity> fromBundle(Map<String, Object?> bundle) async {
    final private = bundle['privateJwk'];
    if (bundle['version'] != 1 ||
        bundle['algorithm'] != algorithm ||
        private is! Map ||
        private['d'] is! String) {
      throw const FormatException('Not a version 1 Ed25519 identity bundle');
    }
    final identity = await fromSeed(fromBase64Url(private['d']! as String));
    if (identity.peerId != bundle['peerId'] ||
        identity.publicJwk['x'] != private['x']) {
      throw const FormatException('Identity bundle does not match its key');
    }
    return identity;
  }

  Map<String, Object?> toBundle() => {
    'version': 1,
    'algorithm': algorithm,
    'peerId': peerId,
    'publicJwk': publicJwk,
    'privateJwk': privateJwk,
  };

  Future<Uint8List> sign(List<int> message) async => Uint8List.fromList(
    (await c.Ed25519().sign(message, keyPair: _pair)).bytes,
  );
}
