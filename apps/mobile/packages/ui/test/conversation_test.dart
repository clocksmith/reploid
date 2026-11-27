import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ui/ui.dart';

Widget _app(Widget child, {double textScale = 1}) => MaterialApp(
  theme: createUiTheme(seedColor: Colors.teal),
  home: MediaQuery(
    data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
    child: child,
  ),
);

void main() {
  testWidgets('composer sends when idle and offers stop while busy', (
    tester,
  ) async {
    final controller = TextEditingController(text: 'draft');
    addTearDown(controller.dispose);
    var sent = 0, stopped = 0;
    Widget build({required bool busy}) => _app(
      Scaffold(
        body: Composer(
          controller: controller,
          hint: 'Ask',
          sendLabel: 'Send',
          stopLabel: 'Stop',
          busy: busy,
          note: 'Read by the answering computer.',
          onSend: () => sent++,
          onStop: () => stopped++,
        ),
      ),
    );
    await tester.pumpWidget(build(busy: false));
    expect(find.text('Read by the answering computer.'), findsOneWidget);
    await tester.tap(find.text('Send'));
    expect((sent, stopped), (1, 0));

    await tester.pumpWidget(build(busy: true));
    expect(find.text('Send'), findsNothing);
    await tester.tap(find.text('Stop'));
    expect((sent, stopped), (1, 1));
    expect(controller.text, 'draft', reason: 'the draft survives a stop');
  });

  testWidgets('a disabled send cannot be tapped', (tester) async {
    final controller = TextEditingController();
    addTearDown(controller.dispose);
    await tester.pumpWidget(
      _app(
        Scaffold(
          body: Composer(
            controller: controller,
            hint: 'Ask',
            sendLabel: 'Send',
            stopLabel: 'Stop',
            onSend: null,
            onStop: null,
          ),
        ),
      ),
    );
    expect(
      tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
      isNull,
    );
  });

  testWidgets('a message announces its status and names its author', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    await tester.pumpWidget(
      _app(
        const Scaffold(
          body: MessageBubble(
            text: 'Partial answer',
            author: 'Answer',
            status: 'Answering',
            caption: 'Sent to peer:1234',
          ),
        ),
      ),
    );
    expect(find.text('Partial answer'), findsOneWidget);
    expect(find.text('Sent to peer:1234'), findsOneWidget);
    final status = tester.getSemantics(find.text('Answering'));
    expect(status.flagsCollection.isLiveRegion, isTrue);
    expect(find.bySemanticsLabel(RegExp('Answer')), findsWidgets);
    handle.dispose();
  });

  testWidgets('a thread keeps its newest turn in view and caps its footer', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 480);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      _app(
        textScale: 2,
        ThreadSurface(
          title: 'Thread',
          footer: Column(
            children: [for (var i = 0; i < 12; i++) Text('footer line $i')],
          ),
          children: [
            for (var i = 0; i < 30; i++)
              MessageBubble(text: 'turn $i', author: 'You'),
          ],
        ),
      ),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('turn 29'), findsOneWidget);
    expect(find.text('turn 0'), findsNothing);
    expect(find.text('footer line 0'), findsOneWidget);
  });

  testWidgets('a short thread starts at the top', (tester) async {
    await tester.pumpWidget(
      _app(
        const ThreadSurface(
          title: 'Thread',
          footer: Text('footer'),
          children: [MessageBubble(text: 'only turn', author: 'You')],
        ),
      ),
    );
    expect(tester.getTopLeft(find.text('only turn')).dy, lessThan(200));
  });

  testWidgets('a switch row toggles from anywhere on the row', (tester) async {
    bool? changed;
    await tester.pumpWidget(
      _app(
        Scaffold(
          body: SwitchRow(
            label: 'Allow network answers',
            description: 'Sends prompts to other computers.',
            value: true,
            onChanged: (value) => changed = value,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Allow network answers'));
    expect(changed, isFalse);
  });

  testWidgets('a choice tile marks the selected option for assistive tech', (
    tester,
  ) async {
    final handle = tester.ensureSemantics();
    var pressed = 0;
    await tester.pumpWidget(
      _app(
        Scaffold(
          body: Column(
            children: [
              ChoiceTile(
                title: 'Small model',
                detail: '1 ready',
                selected: true,
                onPressed: () => pressed++,
              ),
              const ChoiceTile(
                title: 'Large model',
                detail: 'No computer has it',
                selected: false,
                onPressed: null,
              ),
            ],
          ),
        ),
      ),
    );
    await tester.tap(find.text('Small model'));
    await tester.tap(find.text('Large model'), warnIfMissed: false);
    expect(pressed, 1);
    expect(
      tester
          .getSemantics(find.widgetWithText(InkWell, 'Small model'))
          .flagsCollection
          .isSelected,
      Tristate.isTrue,
    );
    handle.dispose();
  });

  testWidgets('notices and labelled values render their text', (tester) async {
    await tester.pumpWidget(
      _app(
        const Scaffold(
          body: Column(
            children: [
              Notice(text: 'Demo network', tone: NoticeTone.warning),
              LabeledValue(label: 'Signing identity', value: 'peer:abcd'),
            ],
          ),
        ),
      ),
    );
    expect(find.text('Demo network'), findsOneWidget);
    expect(find.text('peer:abcd'), findsOneWidget);
  });
}
