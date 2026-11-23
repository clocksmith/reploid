/// Byte encodings and digests named by the requester contract.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:pointycastle/digests/sha256.dart';

import 'canonical_json.dart';

Uint8List utf8Bytes(String text) => Uint8List.fromList(utf8.encode(text));

String hex(List<int> bytes) {
  final out = StringBuffer();
  for (final byte in bytes) {
    out.write(byte.toRadixString(16).padLeft(2, '0'));
  }
  return out.toString();
}

Uint8List sha256(List<int> bytes) =>
    SHA256Digest().process(Uint8List.fromList(bytes));

/// `sha256:` followed by the lowercase hex digest of the UTF-8 text.
String sha256Hex(String text) => 'sha256:${hex(sha256(utf8Bytes(text)))}';

/// Procedure `hashJson`: the digest of the canonical JSON of [value].
String hashJson(Object? value) => sha256Hex(canonicalJson(value));

/// Base64url without padding, as WebCrypto JWK fields and signatures use.
String toBase64Url(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');

Uint8List fromBase64Url(String text) {
  final padded = text.padRight(text.length + (4 - text.length % 4) % 4, '=');
  return Uint8List.fromList(base64Url.decode(padded));
}
