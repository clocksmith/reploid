/// The pure procedures of the requester contract: everything that turns
/// values into the exact objects, texts and checks the wire protocol needs.
/// Each function names the contract procedure it implements.
library;

import 'dart:convert';
import 'dart:math' show pow;

import 'canonical_json.dart';
import 'codec.dart';
import 'contract.g.dart';
import 'identity.dart';

typedef Json = Map<String, Object?>;

/// A failure of one request, with the one fact a person needs about it:
/// whether their prompt had already left this device.
final class ProtocolFailure implements Exception {
  const ProtocolFailure(
    this.message, {
    this.promptSent = false,
    this.declined = false,
    this.code,
  });

  /// The contract's failure text. It may come from the other computer and
  /// must never be logged or shown as trusted copy.
  final String message;
  final bool promptSent;

  /// The provider itself refused the request, as opposed to being lost.
  final bool declined;
  final String? code;

  ProtocolFailure sent() => ProtocolFailure(
    message,
    promptSent: true,
    declined: declined,
    code: code,
  );

  @override
  String toString() => 'ProtocolFailure(promptSent: $promptSent)';
}

final _digest = RegExp(r'^sha256:[a-f0-9]{64}$');
final _fingerprint = RegExp(r'^sha-256 (?:[a-f0-9]{2}:){31}[a-f0-9]{2}$');
final _fingerprintLine = RegExp(
  r'^a=fingerprint:sha-256 ',
  caseSensitive: false,
);
final nonce = RegExp(r'^[a-f0-9-]{36}$');

bool isDigest(Object? value) => value is String && _digest.hasMatch(value);

/// A JavaScript safe integer that is not negative, however JSON spelled it.
bool isCount(Object? value) =>
    value is num &&
    value.isFinite &&
    value >= 0 &&
    value <= 9007199254740991 &&
    value == value.truncateToDouble();

/// Procedure `sdpFingerprint`.
String? sdpFingerprint(String? sdp) {
  final values = <String>{
    for (final line in (sdp ?? '').split(RegExp(r'\r?\n')))
      if (_fingerprintLine.hasMatch(line))
        line.substring(14).trim().toLowerCase(),
  };
  return values.length == 1 && _fingerprint.hasMatch(values.single)
      ? values.single
      : null;
}

/// Procedure `identityProofSignedBytes`: plain JSON text of an array, not
/// canonical JSON.
String identityProofText(Json challenge, String participantId) => jsJson([
  Contract.idIdentityProofDomain,
  challenge['roomId'],
  challenge['nonce'],
  challenge['requester'],
  challenge['provider'],
  challenge['local'],
  challenge['remote'],
  participantId,
]);

/// Procedure `identityProofVerification`. Returns the proven participant.
Future<String> verifyIdentityProof(Json challenge, Json proof) async {
  final key = proof['publicJwk'];
  final participantId = proof['participantId'];
  final signature = proof['signature'];
  if (key is! Map<String, Object?> ||
      participantId is! String ||
      signature is! String ||
      peerIdFromPublicJwk(key) != participantId) {
    throw const ProtocolFailure('Recipient signing identity mismatch');
  }
  final signed = utf8Bytes(identityProofText(challenge, participantId));
  if (!await verifySignature(key, signed, _decode(signature))) {
    throw const ProtocolFailure('Invalid recipient identity proof');
  }
  return participantId;
}

List<int> _decode(String text) {
  try {
    return fromBase64Url(text);
  } on FormatException {
    return const [];
  }
}

/// Procedure `privacyBinding`, for a public whole-model request.
Json privacyPolicy() => {
  'schema': Contract.idExecutionPolicy,
  'placement': 'network-allowed',
  'recipients': {'kind': 'open', 'ids': <Object?>[]},
  'computation': 'plaintext',
  'collusion': 'none',
  'leakage': ['model-id', 'timing', 'length', 'access-patterns', 'plaintext'],
  'protocol': null,
  'attestation': null,
  'keyContext': null,
  'retention': 'execution-and-recovery',
  'publication': false,
  'reuse': false,
  'allowDowngrade': false,
};

Json executionRoute({
  required String modelId,
  required String modelIdentity,
  required String providerId,
  required Json offer,
}) => {
  'schema': Contract.idExecutionRoute,
  'modelId': modelId,
  'modelIdentity': modelIdentity,
  'adapterIdentities': <Object?>[],
  'backend': Contract.generationBackend,
  'protocol': null,
  'route': {
    'schema': Contract.idMeshRoute,
    'providerId': providerId,
    'offerId': offer['id'],
    'backend': offer['backend'],
  },
  'hops': [
    {'recipient': providerId, 'placement': 'remote', 'disclosure': 'plaintext'},
  ],
};

Json privacyBinding(Json policy, Json route) => {
  'schema': Contract.idExecutionBinding,
  'policy': policy,
  'route': route,
  'policyId': hashJson(policy),
  'routeId': hashJson(route),
};

/// Procedure `promptCommitment`.
String promptCommitment(String salt, List<Json> messages) => hashJson({
  'schema': Contract.idPromptCommitment,
  'salt': salt,
  'messages': messages,
  'settings': null,
});

/// Procedure `admitPayloadFromRequest`.
Json admitPayload(Json request, String commitment) => {
  for (final entry in request.entries)
    if (!const {'messages', 'settings', 'admission'}.contains(entry.key))
      entry.key: entry.value,
  'promptCommitment': commitment,
};

/// The stored form of a `reploid:peer-advertisement` (procedure
/// `readyPeerRule`), or null when the frame must be dropped.
final class Advertisement {
  Advertisement._(this.raw, this.offers);

  final Json raw;
  final List<Json> offers;

  static Advertisement? accept(Object? payload) {
    if (payload is! Map<String, Object?>) return null;
    final updatedAt = payload['updatedAt'];
    if (updatedAt is! num || !updatedAt.isFinite) return null;
    final adapters = payload['adapterIdentities'] ?? const <Object?>[];
    if (adapters is! List || adapters.length > 1 || !adapters.every(isDigest)) {
      return null;
    }
    final offers = payload['executionOffers'] ?? const <Object?>[];
    if (offers is! List || offers.length > 32) return null;
    final parsed = <Json>[];
    for (final offer in offers) {
      if (offer is! Map<String, Object?> ||
          offer['id'] is! String ||
          offer['modelIdentities'] is! List) {
        return null;
      }
      parsed.add(offer);
    }
    return Advertisement._(payload, List.unmodifiable(parsed));
  }

  String? get role => raw['role'] is String ? raw['role']! as String : null;
  String? get model => raw['model'] is String ? raw['model']! as String : null;
  String? get modelIdentity =>
      isDigest(raw['modelIdentity']) ? raw['modelIdentity']! as String : null;
  bool get hasInference => raw['hasInference'] == true;

  String get readiness => switch (raw['readiness']) {
    final String value
        when const {'ready', 'loading', 'unavailable'}.contains(value) =>
      value,
    _ => 'unavailable',
  };

  int get availableSlots => _positive(raw['availableSlots']);
  bool get identityCurrent =>
      raw['identityProtocol'] == Contract.generationIdentityProtocol;
  bool get admissionCurrent =>
      raw['admissionProtocol'] == Contract.generationAdmissionProtocol;

  static int _positive(Object? value) =>
      value is num && isCount(value) && value > 0 ? value.toInt() : 0;

  /// Compatible with a catalog row, before readiness is considered.
  bool compatible(CatalogRow row) =>
      identityCurrent &&
      admissionCurrent &&
      model == row.id &&
      modelIdentity == row.identity;

  /// Can answer this row; [busy] tells whether it has a free slot now.
  bool readyFor(CatalogRow row) =>
      compatible(row) && readiness == 'ready' && hasInference;

  bool get busy => availableSlots == 0;

  /// Procedure `providerSelectionRule`: the eligible offers, by id.
  List<Json> eligibleOffers(String modelIdentity) =>
      offers
          .where(
            (offer) =>
                offer['operation'] == 'generate' &&
                offer['kind'] == 'plaintext' &&
                offer['protocol'] == null &&
                offer['backend'] == Contract.generationBackend &&
                (offer['modelIdentities']! as List).contains(modelIdentity),
          )
          .toList()
        ..sort((a, b) => (a['id']! as String).compareTo(b['id']! as String));

  bool selectable(CatalogRow row) =>
      role == 'provider' &&
      readyFor(row) &&
      !busy &&
      eligibleOffers(row.identity).isNotEmpty;

  /// The parts that must not change between selection and sending.
  String get placementKey => canonicalJson([
    raw['admissionProtocol'],
    raw['identityProtocol'],
    readiness,
    busy,
    model,
    raw['modelIdentity'],
    raw['executionOffers'],
  ]);

  /// Self-reported, used only to order providers: the score halves every
  /// thirty days since it was last updated.
  double contributionScore(int nowMs) {
    final contribution = raw['contribution'];
    if (contribution is! Map) return 0;
    final score = contribution['score'], updated = contribution['updatedAt'];
    if (score is! num || !score.isFinite || score <= 0) return 0;
    if (updated is! num || !updated.isFinite) return 0;
    final days = (nowMs - updated) / Duration.millisecondsPerDay;
    return score * pow(.5, days <= 0 ? 0 : days / 30).toDouble();
  }

  int get uniquePeers {
    final contribution = raw['contribution'];
    return contribution is Map ? _positive(contribution['uniquePeers']) : 0;
  }
}

/// Procedure `envelopeValidation`, receiving side: the envelope of a frame
/// that arrived on the connection named [from], or null to drop the frame.
Json? acceptEnvelope(String text, {required String from}) {
  if (text.length > 2 * Contract.rtcMaxPayloadSize) return null;
  final Object? envelope;
  try {
    envelope = jsonDecode(text);
  } on FormatException {
    return null;
  }
  if (envelope is! Map<String, Object?>) return null;
  final type = envelope['type'], size = envelope['payloadSize'];
  final sender = envelope['peerId'];
  if (envelope['protocolVersion'] != Contract.rtcEnvelopeProtocolVersion ||
      type is! String ||
      !Contract.knownTypes.contains(type) ||
      sender is! String ||
      sender.isEmpty ||
      sender != from ||
      envelope['timestamp'] is! num ||
      (size is num && size > Contract.rtcMaxPayloadSize)) {
    return null;
  }
  return envelope;
}

/// Procedure `readyPeerRule`: how a catalog row stands, given the stored
/// advertisement of every connection that can carry a request now.
String rowAvailability(CatalogRow row, Iterable<Advertisement> reachable) {
  final compatible = reachable.where((a) => a.compatible(row)).toList();
  final ready = compatible.where((a) => a.readyFor(row)).toList();
  if (ready.any((a) => !a.busy)) return 'ready';
  if (ready.isNotEmpty) return 'busy';
  if (compatible.any((a) => a.readiness == 'loading')) return 'loading';
  return 'unavailable';
}

/// Procedure `receiptVerification`, steps 1 to 11. Returns the signed
/// payload in contract field order.
Future<Json> verifyResult({
  required String requestId,
  required String modelId,
  required String modelIdentity,
  required List<Json> messages,
  required String provenProvider,
  required String ownParticipantId,
  required int? earlyInputTokens,
  required Object? response,
  required Object? receipt,
}) async {
  const invalid = ProtocolFailure(
    'Remote receipt is invalid or does not bind this request',
  );
  const differs = ProtocolFailure(
    'Measured receipt differs from the admitted request or provider output',
  );
  if (response is! Map<String, Object?>) throw differs;
  if (response['model'] != modelId ||
      response['modelIdentity'] != modelIdentity) {
    throw const ProtocolFailure(
      'Remote response substituted the requested model',
    );
  }
  final adapters = response['adapterIdentities'] ?? const <Object?>[];
  if (jsJson(adapters) != '[]') {
    throw const ProtocolFailure(
      'Remote response substituted the requested adapter',
    );
  }
  final completion = response['completion'];
  if (earlyInputTokens != null &&
      ((completion is Map ? completion['promptTokenCount'] : null) !=
              earlyInputTokens ||
          (receipt is Map ? receipt['inputTokens'] : null) !=
              earlyInputTokens)) {
    throw const ProtocolFailure(
      'Provider input token count differs from its early observation',
    );
  }
  if (receipt is Map && receipt['version'] == 3) {
    throw const ProtocolFailure(
      'Receipt does not bind the generation settings of this request',
    );
  }
  if (receipt is! Map<String, Object?> || receipt['version'] != 2) {
    throw const ProtocolFailure('A version 2 receipt is required');
  }
  final payload = <String, Object?>{
    for (final field in Contract.receiptSignedFields) field: receipt[field],
  };
  final adapterIds = payload['adapterIdentities'];
  final stop = payload['stopReason'];
  final wellFormed =
      payload['status'] == 'completed' &&
      payload['usage'] == Contract.idTokenUsage &&
      payload['cleanup'] == 'settled' &&
      payload['timestamp'] is num &&
      [
        'receiptId',
        'provider',
        'consumer',
        'jobHash',
        'model',
      ].every((field) => payload[field] is String) &&
      isDigest(payload['modelIdentity']) &&
      isDigest(payload['inputDigest']) &&
      isDigest(payload['outputDigest']) &&
      isCount(payload['inputTokens']) &&
      isCount(payload['outputTokens']) &&
      adapterIds is List &&
      adapterIds.length <= 1 &&
      adapterIds.every(isDigest) &&
      (payload['ownerPolicyDigest'] == null ||
          isDigest(payload['ownerPolicyDigest'])) &&
      stop is String &&
      stop.isNotEmpty &&
      stop.length <= 64 &&
      !receipt.containsKey('settingsDigest') &&
      !receipt.containsKey('constraintIdentity');
  final key = receipt['providerKey'];
  final signature = receipt['providerSignature'];
  if (!wellFormed ||
      key is! Map<String, Object?> ||
      signature is! String ||
      peerIdFromPublicJwk(key) != receipt['provider'] ||
      !await verifySignature(
        key,
        utf8Bytes(canonicalJson(payload)),
        _decode(signature),
      ) ||
      receipt['jobHash'] != 'request:$requestId' ||
      receipt['consumer'] != ownParticipantId ||
      receipt['model'] != response['model']) {
    throw invalid;
  }
  final content = response['content'];
  if (completion is! Map<String, Object?> ||
      completion['schema'] != Contract.idGenerationCompletion ||
      !isCount(completion['promptTokenCount']) ||
      !isCount(completion['generatedTokenCount']) ||
      content is! String) {
    throw differs;
  }
  final expected = <String, Object?>{
    'version': 2,
    'status': 'completed',
    'modelIdentity': response['modelIdentity'],
    'adapterIdentities': adapters,
    'inputDigest': hashJson(messages),
    'outputDigest': sha256Hex(content),
    'inputTokens': completion['promptTokenCount'],
    'outputTokens': completion['generatedTokenCount'],
    'usage': Contract.idTokenUsage,
    'stopReason': completion['stopReason'],
    'cleanup': 'settled',
    'ownerPolicyDigest': response['ownerPolicyDigest'],
  };
  if (receipt['provider'] != provenProvider ||
      expected.entries.any(
        (entry) =>
            canonicalJson(receipt[entry.key]) != canonicalJson(entry.value),
      )) {
    throw differs;
  }
  return payload;
}

/// Procedure `receiptCountersign`.
Future<Json> countersign(
  Json payload,
  Json receipt,
  SigningIdentity identity,
) async => {
  ...payload,
  'providerSignature': receipt['providerSignature'],
  'providerKey': receipt['providerKey'],
  'consumerSignature': toBase64Url(
    await identity.sign(utf8Bytes(canonicalJson(payload))),
  ),
  'consumerKey': identity.publicJwk,
};
