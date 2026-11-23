import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:core/core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/chat/domain/chat.dart';
import '../features/chat/infrastructure/chat_repository.dart';
import '../features/chat/infrastructure/conversation_archive.dart';
import '../features/chat/infrastructure/memory_network.dart';
import '../features/chat/infrastructure/pairing_store.dart';
import '../features/chat/infrastructure/preferences_store.dart';
import '../features/chat/infrastructure/requester_api.dart';
import '../infrastructure/device_stores.dart';
import '../infrastructure/identity_store.dart';
import '../infrastructure/network_selection_store.dart';
import '../infrastructure/reploid_api/identity.dart';
import 'network_config.dart';

export '../features/chat/presentation/chat_providers.dart';

final sessionCoordinatorProvider = Provider<SessionCoordinator>(
  (ref) => throw StateError('Bootstrap must supply SessionCoordinator'),
);

/// The platform keystore, supplied by bootstrap.
final secretStoreProvider = Provider<SecretStore>(
  (ref) => throw StateError('Bootstrap must supply SecretStore'),
);

/// The app's private files, supplied by bootstrap.
final fileStoreProvider = Provider<FileStore>(
  (ref) => throw StateError('Bootstrap must supply FileStore'),
);

final identityStoreProvider = Provider<IdentityStore>(
  (ref) => IdentityStore(ref.watch(secretStoreProvider)),
);

final networkPreferenceStoreProvider = Provider<NetworkPreferenceStore>(
  (ref) => NetworkPreferenceStore(ref.watch(secretStoreProvider)),
);

final networkPreferenceProvider =
    NotifierProvider<NetworkPreferenceController, NetworkPreference>(
      NetworkPreferenceController.new,
    );

class NetworkPreferenceController extends Notifier<NetworkPreference> {
  @override
  NetworkPreference build() => NetworkConfig.buildTimePreference();

  /// Loads a saved runtime network preference unless a build-time override
  /// (`--dart-define=REPLOID_NETWORK=...`) pinned a specific room/network.
  Future<void> load() async {
    if (NetworkConfig.hasBuildTimeOverride) return;
    try {
      final stored = await ref.read(networkPreferenceStoreProvider).read();
      if (ref.mounted && stored != null) state = stored;
    } catch (_) {
      // Unreadable store falls back to build-time default.
    }
  }

  /// Back to the build's network, with any saved room token erased.
  Future<void> reset() async {
    if (ref.mounted) state = NetworkConfig.buildTimePreference();
    await ref.read(networkPreferenceStoreProvider).delete();
  }

  Future<void> select(NetworkPreference next) async {
    if (!next.isValid) return;
    if (ref.mounted) state = next;
    try {
      await ref.read(networkPreferenceStoreProvider).write(next);
    } catch (_) {
      // Runtime selection stays active for this run even if persistence fails.
    }
  }
}

ConversationArchive _archive(Ref ref, String participantId) =>
    ConversationArchive(
      files: ref.read(fileStoreProvider),
      secrets: ref.read(secretStoreProvider),
      participantId: participantId,
    );

DevicePreferencesStore _preferences(Ref ref, String participantId) =>
    DevicePreferencesStore(ref.read(secretStoreProvider), participantId);

/// The synthetic network of the demo build and the tests.
final memoryNetworkProvider = Provider<MemoryNetwork>((ref) => MemoryNetwork());

/// Builds the network adapter for one device identity based on the active
/// [networkPreferenceProvider] selection.
final requesterApiFactoryProvider =
    Provider<RequesterApi Function(SigningIdentity, SecretStore)>((ref) {
      final preference = ref.watch(networkPreferenceProvider);
      final signaling = NetworkConfig.signalingFor(preference);
      if (signaling != null) {
        return (identity, secrets) => NetworkConfig.createContractApi(
          config: signaling,
          identity: identity,
          secrets: secrets,
        );
      }
      return (identity, _) => ref
          .watch(memoryNetworkProvider)
          .forIdentity(SessionIdentity(identity.peerId));
    });

/// True while answers come from the synthetic network, so screens say so.
final demoNetworkProvider = Provider<bool>(
  (ref) => ref.watch(networkPreferenceProvider).mode == NetworkMode.demo,
);

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

  /// Ends the session, then deletes its conversations, preferences, pairing,
  /// and signing key. A later Start is a new participant with no history.
  Future<void> forget() async {
    final deviceIdentity = ref.read(deviceIdentityProvider);
    final coordinator = ref.read(sessionCoordinatorProvider);
    final secrets = ref.read(secretStoreProvider);
    final files = ref.read(fileStoreProvider);
    final identityStore = ref.read(identityStoreProvider);
    final identity = deviceIdentity.current;
    try {
      await coordinator.signOut();
    } on AppFailure {
      // The session gate renders cleanup failures without old content.
    }
    deviceIdentity.current = null;
    try {
      if (identity != null) {
        await ConversationArchive(
          files: files,
          secrets: secrets,
          participantId: identity.peerId,
        ).erase();
        await DevicePreferencesStore(secrets, identity.peerId).delete();
        await PairingStore(secrets, identity.peerId).delete();
      }
      await ref.read(networkPreferenceProvider.notifier).reset();
      await identityStore.delete();
    } catch (_) {
      if (ref.mounted) {
        ref.read(startStatusProvider.notifier).set(StartStatus.failed);
      }
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
    api: ref.watch(requesterApiFactoryProvider)(
      identity,
      ref.watch(secretStoreProvider),
    ),
    newId: ref.watch(operationIdProvider),
    archive: _archive(ref, identity.peerId),
    preferences: _preferences(ref, identity.peerId),
  );
  ref.onDispose(() => unawaited(repository.close()));
  return repository;
}
