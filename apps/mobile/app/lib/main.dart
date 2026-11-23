import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, StatefulWidget, State, runApp;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import 'app/app.dart';
import 'app/providers.dart';
import 'infrastructure/identity_store.dart';

void main() => runApp(const ReploidRoot());

class ReploidRoot extends StatefulWidget {
  const ReploidRoot({super.key, this.identityStore, this.overrides = const []});

  /// Where the device key is kept; the platform keystore unless a test or
  /// an environment without one supplies another store.
  final IdentityStore? identityStore;

  /// Further provider overrides, applied last: the network adapter for a
  /// build that reaches real computers, or fakes in a test.
  final List<Override> overrides;

  @override
  State<ReploidRoot> createState() => _ReploidRootState();
}

/// Owns the external coordinator, including its asynchronous shutdown.
class _ReploidRootState extends State<ReploidRoot> {
  final coordinator = SessionCoordinator();

  @override
  void dispose() {
    unawaited(coordinator.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ProviderScope(
    overrides: [
      sessionCoordinatorProvider.overrideWithValue(coordinator),
      identityStoreProvider.overrideWithValue(
        widget.identityStore ?? const SecureIdentityStore(),
      ),
      chatRepositoryProvider.overrideWith(createChatRepository),
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
