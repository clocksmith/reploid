import 'package:core/core.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/app/app.dart';
import 'package:reploid_mobile/app/providers.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/features/tasks/infrastructure/memory_task_server.dart';

Future<void> tapText(WidgetTester tester, String text) async {
  final target = find.text(text);
  await tester.ensureVisible(target);
  await tester.tap(target);
}

void main() {
  testWidgets('list, detail, failure, retry, Back, and account replacement', (
    tester,
  ) async {
    final coordinator = SessionCoordinator();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      final closing = coordinator.dispose();
      await tester.pump();
      await closing;
    });
    final server = MemoryTaskServer(latency: Duration.zero);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionCoordinatorProvider.overrideWithValue(coordinator),
          taskRepositoryProvider.overrideWith(createTaskRepository),
          memoryServerProvider.overrideWithValue(server),
        ],
        child: const ReploidApp(),
      ),
    );
    await tapText(tester, Strings.accountA);
    await tester.pumpAndSettle();
    await tapText(tester, 'A: Plan the first release');
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Keep this draft');
    await tester.pump();
    server.simulateNextCompletion(
      const SessionIdentity('A'),
      CompletionBehavior.reject,
    );
    await tapText(tester, Strings.complete);
    await tester.pumpAndSettle();
    expect(find.text('Keep this draft'), findsOneWidget);
    expect(find.text(Strings.failure(FailureKind.validation)), findsOneWidget);
    await tapText(tester, Strings.complete);
    await tester.pumpAndSettle();
    expect(find.text(Strings.completed), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text(Strings.completed), findsOneWidget);
    await tapText(tester, 'A: Review the checklist');
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Private A draft');
    await tapText(tester, Strings.rejectNext);
    await tester.pump();
    expect(find.text(Strings.failureArmed), findsOneWidget);
    await tapText(tester, Strings.accountB);
    await tester.pumpAndSettle();
    expect(find.text('Private A draft'), findsNothing);
    expect(find.text(Strings.failureArmed), findsNothing);
    expect(find.text('A: Review the checklist'), findsNothing);
    expect(find.text('B: Plan the first release'), findsOneWidget);
    expect(find.byType(BackButton), findsNothing);
    await tapText(tester, Strings.signOut);
    await tester.pumpAndSettle();
    expect(find.text(Strings.demo), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  testWidgets('pending A read cannot flash when B becomes ready', (
    tester,
  ) async {
    final coordinator = SessionCoordinator();
    addTearDown(() async {
      await tester.pumpWidget(const SizedBox.shrink());
      final closing = coordinator.dispose();
      await tester.pump();
      await closing;
    });
    final server = MemoryTaskServer(latency: const Duration(seconds: 1));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sessionCoordinatorProvider.overrideWithValue(coordinator),
          taskRepositoryProvider.overrideWith(createTaskRepository),
          memoryServerProvider.overrideWithValue(server),
        ],
        child: const ReploidApp(),
      ),
    );
    await tapText(tester, Strings.accountA);
    await tester.pump();
    await tester.pump();
    await tapText(tester, Strings.accountB);
    for (var frame = 0; frame < 15; frame++) {
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('A: Plan the first release'), findsNothing);
    }
    expect(find.text('B: Plan the first release'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
