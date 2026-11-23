import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show BuildContext, Widget, StatefulWidget, State, runApp;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/providers.dart';

void main() => runApp(const ReploidRoot());

class ReploidRoot extends StatefulWidget {
  const ReploidRoot({super.key});

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
      taskRepositoryProvider.overrideWith(createTaskRepository),
    ],
    child: const ReploidApp(),
  );
}
