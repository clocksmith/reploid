import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/contract.g.dart';
import 'package:reploid_mobile/infrastructure/reploid_api/turn_client_io.dart';

void main() {
  test('fetches, caches, and refreshes ephemeral TURN credentials', () async {
    var hits = 0;
    String? seenOrigin;
    String? seenAuth;
    var clock = DateTime.utc(2026, 11, 23, 12, 0, 0);

    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      hits++;
      seenOrigin = request.headers.value('Origin');
      seenAuth = request.headers.value('Authorization');
      final expires = clock.add(const Duration(seconds: 600));
      request.response
        ..statusCode = HttpStatus.ok
        ..headers.contentType = ContentType.json
        ..write(
          jsonEncode({
            'schema': Contract.idTurnCredentials,
            'issuedAt': clock.toIso8601String(),
            'expiresAt': expires.toIso8601String(),
            'ttlSeconds': 600,
            'rtcConfig': {
              'iceTransportPolicy': 'all',
              'iceServers': [
                {
                  'urls': [
                    'turn:turn.example.com:3478?transport=udp',
                    'turns:turn.example.com:443?transport=tcp',
                  ],
                  'username': 'user-$hits',
                  'credential': 'secret-$hits',
                  'credentialType': 'password',
                },
              ],
            },
          }),
        );
      await request.response.close();
    });

    final client = HttpTurnClient(
      rtcConfigUrl: 'http://127.0.0.1:${server.port}/rtc-config',
      origin: 'https://replo.id',
      authToken: 'test-firebase-token',
      now: () => clock,
    );
    addTearDown(client.close);

    final first = await client.fetchTurnConfig();
    expect(first, isNotNull);
    expect(seenOrigin, 'https://replo.id');
    expect(seenAuth, 'Bearer test-firebase-token');
    expect(first!.iceTransportPolicy, 'all');
    expect(first.iceServers, hasLength(1));
    expect(first.iceServers.single.username, 'user-1');
    expect(first.iceServers.single.credential, 'secret-1');
    expect(hits, 1);

    // Still fresh (more than 60s before expiry): returns cached config.
    clock = clock.add(const Duration(seconds: 300));
    final cached = await client.fetchTurnConfig();
    expect(cached!.iceServers.single.username, 'user-1');
    expect(hits, 1);

    // Within refresh skew (< 60s left): fetches fresh credentials.
    clock = clock.add(const Duration(seconds: 260));
    final refreshed = await client.fetchTurnConfig();
    expect(refreshed!.iceServers.single.username, 'user-2');
    expect(hits, 2);
  });

  test(
    'returns null cleanly on 401, 503, redirect, or invalid schema',
    () async {
      var status = HttpStatus.unauthorized;
      Object body = {'error': 'Firebase auth token required'};
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      addTearDown(() => server.close(force: true));
      server.listen((request) async {
        request.response.statusCode = status;
        if (status == HttpStatus.found) {
          request.response.headers.set('Location', 'https://evil.example/');
        }
        request.response.write(jsonEncode(body));
        await request.response.close();
      });

      final client = HttpTurnClient(
        rtcConfigUrl: 'http://127.0.0.1:${server.port}/rtc-config',
        origin: 'https://replo.id',
      );
      addTearDown(client.close);

      expect(await client.fetchTurnConfig(), isNull);

      status = HttpStatus.serviceUnavailable;
      body = {
        'error': 'TURN relay is not configured',
        'code': 'turn_not_configured',
      };
      expect(await client.fetchTurnConfig(), isNull);

      status = HttpStatus.found;
      expect(await client.fetchTurnConfig(), isNull);

      status = HttpStatus.ok;
      body = {
        'schema': 'wrong/v1',
        'rtcConfig': {'iceServers': []},
      };
      expect(await client.fetchTurnConfig(), isNull);
    },
  );

  test('parses reploid.swarm-bootstrap/v1 over HTTP', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      request.response
        ..statusCode = HttpStatus.ok
        ..write(
          jsonEncode({
            'schema': Contract.idSwarmBootstrap,
            'signalingUrl': 'wss://reploid-swarm.reploid.workers.dev/swarm',
            'publicRoomId': 'reploid-swarm-public',
            'publicJoinMarker': 'reploid-public-namespace-not-a-secret-v1',
            'rtcConfigUrl':
                'https://reploid-swarm.reploid.workers.dev/rtc-config',
            'rtcRefreshSkewMs': 45000,
          }),
        );
      await request.response.close();
    });

    final client = HttpTurnClient(
      rtcConfigUrl: null,
      origin: 'https://replo.id',
    );
    addTearDown(client.close);

    final bootstrap = await client.fetchBootstrap(
      Uri.parse('http://127.0.0.1:${server.port}/bootstrap'),
    );
    expect(bootstrap, isNotNull);
    expect(bootstrap!.signalingUrl, Contract.signalingPublicUrl);
    expect(bootstrap.publicRoomId, Contract.signalingPublicRoomId);
    expect(
      bootstrap.rtcConfigUrl,
      'https://reploid-swarm.reploid.workers.dev/rtc-config',
    );
    expect(bootstrap.rtcRefreshSkewMs, 45000);
  });
}
