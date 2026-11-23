import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';
import 'package:reploid_mobile/infrastructure/identity_store.dart';

void main() {
  test(
    'creates an identity when empty and reloads the same identity',
    () async {
      final secrets = MemorySecretStore();
      final store = IdentityStore(secrets);

      final first = await loadOrCreateIdentity(store);
      final raw = await store.read();
      expect(raw, isNotNull);

      final second = await loadOrCreateIdentity(store);
      expect(second.peerId, first.peerId);
      expect(await store.read(), raw);
    },
  );

  test(
    'corrupt stored identity fails closed without overwriting store',
    () async {
      for (final corrupt in ['not json {', '"just-a-string"', '{"bad":1}']) {
        final secrets = MemorySecretStore();
        final store = IdentityStore(secrets);
        await store.write(corrupt);

        await expectLater(
          loadOrCreateIdentity(store),
          throwsA(isA<FormatException>()),
        );
        expect(
          await store.read(),
          corrupt,
          reason: 'corrupt bundle must never be silently overwritten',
        );
      }
    },
  );
}
