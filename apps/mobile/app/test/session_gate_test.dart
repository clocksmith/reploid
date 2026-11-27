import 'package:core/core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/app/session_gate.dart';

void main() {
  testWidgets('account replacement destroys widget drafts', (tester) async {
    final coordinator = SessionCoordinator();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      final closing = coordinator.dispose();
      await tester.pump();
      await closing;
    });
    await coordinator.activate(const SessionIdentity('A'));
    Widget app() => MaterialApp(
      home: SessionGate(
        state: coordinator.state,
        signedOut: (_) => const Text('Signed out'),
        transitioning: (_) => const Text('Switching'),
        failure: (_, _) => const Text('Failure'),
        ready: (_, _) => const Scaffold(body: TextField()),
      ),
    );
    await tester.pumpWidget(app());
    await tester.enterText(find.byType(TextField), 'A private draft');
    await coordinator.activate(const SessionIdentity('B'));
    await tester.pumpWidget(app());
    expect(find.text('A private draft'), findsNothing);
    final switching = coordinator.signOut();
    await tester.pumpWidget(app());
    expect(find.byType(TextField), findsNothing);
    await switching;
    await tester.pumpWidget(app());
    expect(find.text('Signed out'), findsOneWidget);
  });
}
