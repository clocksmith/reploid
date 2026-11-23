import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:core/core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/chat/domain/chat.dart';
import '../features/chat/infrastructure/chat_repository.dart';
import '../features/chat/infrastructure/memory_network.dart';
import '../features/chat/infrastructure/requester_api.dart';
import '../infrastructure/identity_store.dart';
import '../infrastructure/reploid_api/identity.dart';

export '../features/chat/presentation/chat_providers.dart';

final sessionCoordinatorProvider = Provider<SessionCoordinator>(
  (ref) => throw StateError('Bootstrap must supply SessionCoordinator'),
);

final identityStoreProvider = Provider<IdentityStore>(
  (ref) => throw StateError('Bootstrap must supply IdentityStore'),
);

/// The synthetic network of the demo build and the tests.
final memoryNetworkProvider = Provider<MemoryNetwork>((ref) => MemoryNetwork());

/// Builds the network adapter for one device identity. The default is the
/// synthetic network; bootstrap overrides it to reach real computers.
final requesterApiFactoryProvider =
    Provider<RequesterApi Function(SigningIdentity)>(
      (ref) =>
          (identity) => ref
              .watch(memoryNetworkProvider)
              .forIdentity(SessionIdentity(identity.peerId)),
    );

/// True while answers come from the synthetic network, so screens say so.
final demoNetworkProvider = Provider<bool>((ref) => true);

final operationIdProvider = Provider<String Function()>((ref) {
  final random = Random.secure();
  return () => base64UrlEncode(List.generate(24, (_) => random.nextInt(256)));
});

/// The signing identity behind the active session. Held outside session
/// state because the key is a credential, not an identity boundary.
final class DeviceIdentity {
  SigningIdentity? current;
}

final deviceIdentityProvider = Provider<DeviceIdentity>(
  (ref) => DeviceIdentity(),
);

enum StartStatus { idle, starting, failed }

final startStatusProvider = NotifierProvider<StartController, StartStatus>(
  StartController.new,
);

class StartController extends Notifier<StartStatus> {
  @override
  StartStatus build() => StartStatus.idle;

  void set(StartStatus next) {
    if (ref.mounted) state = next;
  }
}

final sessionStateProvider = NotifierProvider<SessionController, SessionState>(
  SessionController.new,
);

class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() {
    final coordinator = ref.watch(sessionCoordinatorProvider);
    final subscription = coordinator.watch().listen((next) {
      if (ref.mounted) state = next;
    });
    ref.onDispose(() => unawaited(subscription.cancel()));
    return coordinator.state;
  }

  /// Loads this device's signing identity, creating it on first use, and
  /// opens a session for it.
  Future<void> start() async {
    final status = ref.read(startStatusProvider.notifier);
    if (ref.read(startStatusProvider) == StartStatus.starting) return;
    status.set(StartStatus.starting);
    try {
      final identity = await loadOrCreateIdentity(
        ref.read(identityStoreProvider),
      );
      if (!ref.mounted) return;
      ref.read(deviceIdentityProvider).current = identity;
      await ref
          .read(sessionCoordinatorProvider)
          .activate(SessionIdentity(identity.peerId));
      status.set(StartStatus.idle);
    } catch (_) {
      // Storage or cleanup failed. Nothing private is shown; Start retries.
      status.set(StartStatus.failed);
    }
  }

  /// Resumes without a tap when this device already has an identity.
  Future<void> resume() async {
    try {
      if (await ref.read(identityStoreProvider).read() == null) return;
    } catch (_) {
      return;
    }
    if (ref.mounted && state.status == SessionStatus.signedOut) await start();
  }

  /// Ends the session, then deletes the key. A later Start is a new
  /// participant with no conversations.
  Future<void> forget() async {
    try {
      await ref.read(sessionCoordinatorProvider).signOut();
    } on AppFailure {
      // The session gate renders cleanup failures without old content.
    }
    ref.read(deviceIdentityProvider).current = null;
    try {
      await ref.read(identityStoreProvider).delete();
    } catch (_) {
      ref.read(startStatusProvider.notifier).set(StartStatus.failed);
    }
  }
}

/// Called by the composition override; the implementation remains private to it.
ChatRepository? createChatRepository(Ref ref) {
  final session = ref.watch(sessionStateProvider).session;
  final identity = ref.watch(deviceIdentityProvider).current;
  if (session == null ||
      !session.isActive ||
      identity == null ||
      identity.peerId != session.key.identity.accountId) {
    return null;
  }
  final repository = SessionChatRepository(
    session: session,
    api: ref.watch(requesterApiFactoryProvider)(identity),
    newId: ref.watch(operationIdProvider),
  );
  ref.onDispose(() => unawaited(repository.close()));
  return repository;
}
