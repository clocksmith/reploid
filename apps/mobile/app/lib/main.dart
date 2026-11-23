import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, StatefulWidget, State, runApp;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:ui/ui.dart';

import 'app/app.dart';
import 'app/providers.dart';
import 'features/chat/domain/chat.dart' show DocumentPicker;
import 'infrastructure/device_stores.dart';
import 'infrastructure/document_picker.dart';

void main() => runApp(const ReploidRoot());

class ReploidRoot extends StatefulWidget {
  const ReploidRoot({
    super.key,
    this.secrets,
    this.files,
    this.picker,
    this.overrides = const [],
  });

  /// Where keys are kept; the platform keystore unless a test or an
  /// environment without one supplies another store.
  final SecretStore? secrets;

  /// Where encrypted history is kept; the app's private directory by
  /// default on IO platforms, or memory on web.
  final FileStore? files;

  /// The file dialogs; the system's unless a test supplies its own.
  final DocumentPicker? picker;

  /// Further provider overrides, applied last: fakes or custom adapters in tests.
  final List<Override> overrides;

  @override
  State<ReploidRoot> createState() => _ReploidRootState();
}

/// Owns the external coordinator, including its asynchronous shutdown.
class _ReploidRootState extends State<ReploidRoot> {
  final coordinator = SessionCoordinator();
  late final SecretStore _secrets = widget.secrets ?? const SecureSecretStore();
  late final FileStore _files = widget.files ?? createDefaultFileStore();

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
      documentPickerProvider.overrideWithValue(
        widget.picker ?? const PlatformDocumentPicker(),
      ),
      chatRepositoryProvider.overrideWith(createChatRepository),
      ...widget.overrides,
    ],
    child: const _Resume(child: ReploidApp()),
  );
}

/// Loads saved network selection, resumes an existing device identity, and
/// flushes/reconnects across app lifecycle transitions.
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
    unawaited(() async {
      await ref.read(appearanceProvider.notifier).load();
      if (!mounted) return;
      await ref.read(networkPreferenceProvider.notifier).load();
      if (mounted) await ref.read(sessionStateProvider.notifier).resume();
    }());
  }

  @override
  Widget build(BuildContext context) => LifecycleScope(
    onPause: () => unawaited(ref.read(chatRepositoryProvider)?.flush()),
    onResume: () {
      final repository = ref.read(chatRepositoryProvider);
      if (repository != null) unawaited(repository.reconnect());
    },
    child: widget.child,
  );
}
