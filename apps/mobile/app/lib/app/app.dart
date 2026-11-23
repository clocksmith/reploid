import 'dart:async';

import 'package:core/core.dart';
import 'package:flutter/material.dart'
    show
        BuildContext,
        Widget,
        MaterialApp,
        Locale,
        Navigator,
        MaterialPageRoute,
        ScaffoldMessenger;
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ui/ui.dart';

import '../design_system/branding.dart';
import '../features/tasks/infrastructure/memory_task_server.dart';
import '../features/tasks/presentation/task_screens.dart';
import '../l10n/strings.dart';
import 'providers.dart';
import 'session_gate.dart';

class ReploidApp extends ConsumerWidget {
  const ReploidApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp(
    title: Strings.title,
    theme: appTheme(),
    darkTheme: appTheme(dark: true),
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    supportedLocales: const [Locale('en')],
    home: SessionGate(
      state: ref.watch(sessionStateProvider),
      signedOut: (_) => const _SignIn(),
      transitioning: (_) => const PageSurface(
        title: Strings.title,
        children: [BodyCopy(Strings.switching)],
      ),
      failure: (_, _) => const _SignIn(failed: true),
      ready: (_, session) => ScaffoldMessenger(
        child: Navigator(
          onGenerateRoute: (settings) => MaterialPageRoute<void>(
            settings: settings,
            builder: (context) => TaskListScreen(
              session: session,
              actions: _AccountActions(session: session),
              openTask: (id) => unawaited(
                Navigator.of(context).push<void>(
                  MaterialPageRoute(
                    builder: (context) => TaskDetailScreen(
                      session: session,
                      taskId: id,
                      actions: _AccountActions(session: session),
                      rejectNext: () => _simulate(
                        context,
                        ref,
                        session,
                        CompletionBehavior.reject,
                      ),
                      loseNext: () => _simulate(
                        context,
                        ref,
                        session,
                        CompletionBehavior.loseResponse,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );

  void _simulate(
    BuildContext context,
    WidgetRef ref,
    SessionHandle session,
    CompletionBehavior behavior,
  ) {
    if (!session.isActive) return;
    ref
        .read(memoryServerProvider)
        .simulateNextCompletion(session.key.identity, behavior);
    showNotice(context, Strings.failureArmed);
  }
}

class _AccountActions extends ConsumerWidget {
  const _AccountActions({required this.session});
  final SessionHandle session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final other = session.key.identity.accountId == 'A' ? 'B' : 'A';
    return ActionGroup(
      children: [
        SecondaryAction(
          label: other == 'A' ? Strings.accountA : Strings.accountB,
          onPressed: () => unawaited(
            ref.read(sessionStateProvider.notifier).activate(other),
          ),
        ),
        SecondaryAction(
          label: Strings.signOut,
          onPressed: () =>
              unawaited(ref.read(sessionStateProvider.notifier).signOut()),
        ),
      ],
    );
  }
}

class _SignIn extends ConsumerWidget {
  const _SignIn({this.failed = false});
  final bool failed;

  @override
  Widget build(BuildContext context, WidgetRef ref) => PageSurface(
    title: Strings.title,
    children: [
      const SectionHeading(
        title: Strings.welcome,
        description: Strings.welcomeDetail,
      ),
      ContentCard(
        children: [
          const SectionHeading(title: Strings.chooseAccount),
          BodyCopy(failed ? Strings.sessionFailure : Strings.demo),
          ActionButton(
            label: Strings.accountA,
            pendingLabel: Strings.switching,
            onPressed: () => unawaited(
              ref.read(sessionStateProvider.notifier).activate('A'),
            ),
          ),
          SecondaryAction(
            label: Strings.accountB,
            onPressed: () => unawaited(
              ref.read(sessionStateProvider.notifier).activate('B'),
            ),
          ),
        ],
      ),
    ],
  );
}
