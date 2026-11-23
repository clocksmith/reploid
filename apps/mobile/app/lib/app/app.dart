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
import '../features/chat/presentation/chat_screens.dart';
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
      signedOut: (_) => const _Start(),
      transitioning: (_) => const PageSurface(
        title: Strings.title,
        children: [BodyCopy(Strings.switching)],
      ),
      failure: (_, _) => const _Start(failed: true),
      ready: (_, session) => ScaffoldMessenger(
        child: Navigator(
          onGenerateRoute: (settings) => MaterialPageRoute<void>(
            settings: settings,
            builder: (context) => _Home(session: session),
          ),
        ),
      ),
    ),
  );
}

/// The private routes of one session. The whole subtree is replaced when
/// the session changes, so no route, draft or effect outlives it.
class _Home extends ConsumerWidget {
  const _Home({required this.session});
  final SessionHandle session;

  void _push(BuildContext context, Widget Function(BuildContext) builder) =>
      unawaited(
        Navigator.of(context).push<void>(MaterialPageRoute(builder: builder)),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) => ConversationListScreen(
    session: session,
    banner: ref.watch(demoNetworkProvider) ? Strings.demoNetwork : null,
    openComputers: () =>
        _push(context, (_) => ComputersScreen(session: session)),
    openSettings: () => _push(
      context,
      (_) => SettingsScreen(
        session: session,
        forget: () =>
            unawaited(ref.read(sessionStateProvider.notifier).forget()),
      ),
    ),
    openConversation: (id) => _push(
      context,
      (context) => ConversationScreen(
        session: session,
        conversationId: id,
        closed: () => Navigator.of(context).maybePop(),
        openModels: () => _push(
          context,
          (context) => ModelsScreen(
            session: session,
            conversationId: id,
            done: () => Navigator.of(context).maybePop(),
          ),
        ),
      ),
    ),
  );
}

class _Start extends ConsumerWidget {
  const _Start({this.failed = false});
  final bool failed;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(startStatusProvider);
    return PageSurface(
      title: Strings.title,
      children: [
        const SectionHeading(
          title: Strings.welcome,
          description: Strings.welcomeDetail,
        ),
        ContentCard(
          children: [
            const BodyCopy(Strings.startDetail),
            if (ref.watch(demoNetworkProvider))
              const Notice(text: Strings.demoNetwork),
            if (failed || status == StartStatus.failed)
              const Notice(
                text: Strings.sessionFailure,
                tone: NoticeTone.error,
              ),
            ActionButton(
              label: Strings.start,
              pendingLabel: Strings.starting,
              pending: status == StartStatus.starting,
              onPressed: () =>
                  unawaited(ref.read(sessionStateProvider.notifier).start()),
            ),
          ],
        ),
      ],
    );
  }
}
