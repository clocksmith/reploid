import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ui/ui.dart';

void main() {
  testWidgets('refresh and error preserve content and expose retry', (
    tester,
  ) async {
    var retries = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AsyncContent(
            loadingLabel: 'Refreshing',
            emptyLabel: 'Empty',
            retryLabel: 'Retry',
            content: const Text('Confirmed content'),
            loading: true,
            errorMessage: 'Try again',
            onRetry: () => retries++,
          ),
        ),
      ),
    );
    expect(find.text('Confirmed content'), findsOneWidget);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    await tester.tap(find.text('Retry'));
    expect(retries, 1);
  });

  testWidgets('pending action is disabled and accommodates large text', (
    tester,
  ) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: createUiTheme(
          seedColor: Colors.blue,
          brightness: Brightness.dark,
        ),
        home: MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.5)),
          child: Scaffold(
            body: SizedBox(
              width: 240,
              child: ActionButton(
                label: 'Complete this task',
                pendingLabel: 'Saving your changes',
                pending: true,
                onPressed: () => taps++,
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Saving your changes'));
    expect(taps, 0);
    expect(tester.takeException(), isNull);
  });
  testWidgets('resource tile exposes an accessible keyboard action', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();

    try {
      var opened = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: createUiTheme(seedColor: Colors.green),
          home: PageSurface(
            title: 'Resources',
            children: [
              ActionTile(
                title: 'An independent resource',
                status: const StatusBadge(label: 'Available'),
                onPressed: () => opened++,
              ),
            ],
          ),
        ),
      );
      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pump();
      expect(opened, 1);
      expect(
        tester.getSemantics(find.byType(InkWell)),
        matchesSemantics(
          label: 'An independent resource\nAvailable',
          isButton: true,
          hasTapAction: true,
          hasFocusAction: true,
          isFocusable: true,
          isFocused: true,
        ),
      );
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    } finally {
      semantics.dispose();
    }
  });

  for (final brightness in Brightness.values) {
    testWidgets(
      'surfaces accommodate narrow layouts and large text in $brightness',
      (tester) async {
        tester.view.physicalSize = const Size(360, 800);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final controller = TextEditingController(text: 'Retained draft');
        addTearDown(controller.dispose);
        await tester.pumpWidget(
          MaterialApp(
            theme: createUiTheme(
              seedColor: Colors.green,
              brightness: brightness,
            ),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(context)
                  .copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: PageSurface(
              title: 'Example',
              children: [
                const SectionHeading(
                  title: 'A longer localized heading',
                  description: 'Readable supporting text',
                ),
                ActionTile(
                  title: 'A resource with a longer title',
                  status: const StatusBadge(label: 'Waiting for confirmation'),
                  onPressed: () {},
                ),
                NoteInput(
                  controller: controller,
                  label: 'Note',
                  hint: 'Add a note',
                  readOnly: true,
                ),
                ActionGroup(
                  children: [
                    SecondaryAction(
                      label: 'Another longer action',
                      onPressed: () {},
                    ),
                    const SecondaryAction(label: 'Disabled action'),
                  ],
                ),
              ],
            ),
          ),
        );
        await tester.pump();
        expect(tester.takeException(), isNull);
        expect(controller.text, 'Retained draft');
      },
    );
  }
}
