import 'package:core/core.dart';
import 'package:flutter/widgets.dart'
    show
        BuildContext,
        Widget,
        StatelessWidget,
        WidgetBuilder,
        KeyedSubtree,
        ValueKey,
        Builder;

/// Replaces the entire private subtree (including its Navigator) on a switch.
/// Pass the coordinator's current state, not a retained async snapshot.
class SessionGate extends StatelessWidget {
  const SessionGate({
    super.key,
    required this.state,
    required this.signedOut,
    required this.transitioning,
    required this.failure,
    required this.ready,
  });

  final SessionState state;
  final WidgetBuilder signedOut;
  final WidgetBuilder transitioning;
  final Widget Function(BuildContext, AppFailure) failure;
  final Widget Function(BuildContext, SessionHandle) ready;

  @override
  Widget build(BuildContext context) {
    final session = state.session;
    if (state.status == SessionStatus.ready &&
        session != null &&
        session.isActive) {
      return KeyedSubtree(
        key: ValueKey(session.key),
        child: Builder(builder: (context) => ready(context, session)),
      );
    }
    return switch (state.status) {
      SessionStatus.signedOut || SessionStatus.closed => signedOut(context),
      SessionStatus.failed => failure(context, state.failure!),
      _ => transitioning(context),
    };
  }
}
