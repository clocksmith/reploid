import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, StatefulWidget, State, runApp;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import 'app/app.dart';
import 'app/network_config.dart';
import 'app/providers.dart';
import 'infrastructure/device_stores.dart';

void main() => runApp(const ReploidRoot());

class ReploidRoot extends StatefulWidget {
  const ReploidRoot({
    super.key,
    this.secrets,
    this.files,
    this.overrides = const [],
  });

  /// Where keys are kept; the platform keystore unless a test or an
  /// environment without one supplies another store.
  final SecretStore? secrets;

  /// Where encrypted history is kept; the app's private directory by
  /// default.
  final FileStore? files;

  /// Further provider overrides, applied last: the network adapter for a
  /// build that reaches real computers, or fakes in a test.
  final List<Override> overrides;

  @override
  State<ReploidRoot> createState() => _ReploidRootState();
}

/// Owns the external coordinator, including its asynchronous shutdown.
class _ReploidRootState extends State<ReploidRoot> {
  final coordinator = SessionCoordinator();
  late final SecretStore _secrets = widget.secrets ?? const SecureSecretStore();
  late final FileStore _files = widget.files ?? DirectoryFileStore();

  @override
  void dispose() {
    unawaited(coordinator.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ProviderScope(
    overrides: [
      sessionCoordinatorProvider.overrideWithValue(coordinator),
      secretStoreProvider.overrideWithValue(_secrets),
      fileStoreProvider.overrideWithValue(_files),
      chatRepositoryProvider.overrideWith(createChatRepository),
      ...NetworkConfig.overrides(),
      ...widget.overrides,
    ],
    child: const _Resume(child: ReploidApp()),
  );
}

/// Returns a device that already has an identity straight to its session.
class _Resume extends ConsumerStatefulWidget {
  const _Resume({required this.child});
  final Widget child;

  @override
  ConsumerState<_Resume> createState() => _ResumeState();
}

class _ResumeState extends ConsumerState<_Resume> {
  @override
  void initState() {
    super.initState();
    unawaited(ref.read(sessionStateProvider.notifier).resume());
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
