import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'turn_types.dart';

/// Native `dart:io` HTTPS client for Reploid `/rtc-config` TURN credentials
/// and `reploid.swarm-bootstrap/v1` discovery metadata.
///
/// Failures (401 without Firebase auth, 503 when TURN is unconfigured, network
/// errors, invalid or oversized payloads) return null so callers fall back to
/// direct STUN connections per the requester contract.
final class HttpTurnClient implements TurnClient {
  HttpTurnClient({
    required this.rtcConfigUrl,
    required this.origin,
    this.authToken,
    this.refreshSkew = const Duration(milliseconds: 60000),
    this.timeout = const Duration(seconds: 10),
    DateTime Function()? now,
    HttpClient? httpClient,
  }) : _now = now ?? DateTime.now,
       _client = httpClient ?? HttpClient();

  static const _maxResponseBytes = 65536;

  final String? rtcConfigUrl;
  final String origin;
  final String? authToken;
  final Duration refreshSkew;
  final Duration timeout;
  final DateTime Function() _now;
  final HttpClient _client;
  RtcConfiguration? _cached;
  bool _closed = false;

  @override
  Future<RtcConfiguration?> fetchTurnConfig() async {
    if (_closed) return null;
    final urlText = rtcConfigUrl;
    if (urlText == null || urlText.trim().isEmpty) return null;
    final cached = _cached;
    if (cached != null && cached.isFresh(_now(), refreshSkew)) {
      return cached;
    }
    final uri = Uri.tryParse(urlText);
    if (uri == null || (uri.scheme != 'https' && uri.scheme != 'http')) {
      return null;
    }
    final decoded = await _getJson(
      uri,
      headers: {
        'Origin': origin,
        // A bearer token never crosses the network in the clear.
        if (authToken != null &&
            authToken!.trim().isNotEmpty &&
            _mayCarryCredential(uri))
          'Authorization': 'Bearer ${authToken!.trim()}',
      },
    );
    final parsed = parseTurnCredentialsResponse(decoded);
    if (parsed != null) _cached = parsed;
    return parsed;
  }

  @override
  Future<SwarmBootstrapConfig?> fetchBootstrap(Uri url) async {
    if (_closed) return null;
    if (url.scheme != 'https' && url.scheme != 'http') return null;
    final decoded = await _getJson(url, headers: {'Origin': origin});
    return parseSwarmBootstrapResponse(decoded);
  }

  static bool _mayCarryCredential(Uri uri) =>
      uri.scheme == 'https' ||
      uri.host == 'localhost' ||
      uri.host == '127.0.0.1' ||
      uri.host == '::1';

  Future<Object?> _getJson(
    Uri uri, {
    required Map<String, String> headers,
  }) async {
    try {
      final request = await _client.getUrl(uri).timeout(timeout);
      request.followRedirects = false;
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      headers.forEach(request.headers.set);
      final response = await request.close().timeout(timeout);
      if (response.statusCode != HttpStatus.ok) {
        await response.drain<void>();
        return null;
      }
      final bytes = <int>[];
      await for (final chunk in response.timeout(timeout)) {
        bytes.addAll(chunk);
        if (bytes.length > _maxResponseBytes) return null;
      }
      return jsonDecode(utf8.decode(bytes));
    } catch (_) {
      return null;
    }
  }

  @override
  void close() {
    if (_closed) return;
    _closed = true;
    _client.close(force: true);
  }
}

TurnClient createPlatformTurnClient({
  required String? rtcConfigUrl,
  required String origin,
  String? authToken,
}) => HttpTurnClient(
  rtcConfigUrl: rtcConfigUrl,
  origin: origin,
  authToken: authToken,
);
