// The new surfaces as a person uses them, on a phone-sized screen.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:reploid_mobile/app/providers.dart';
import 'package:reploid_mobile/features/chat/domain/chat.dart';
import 'package:reploid_mobile/features/chat/infrastructure/memory_network.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/main.dart';

const _step = Duration(milliseconds: 20);
const _peerA = 'peer:00000000000000000000000a';

final class _Picker implements DocumentPicker {
  List<PickedFile> next = const [];
  PickedFile? dataFile;
  String? saved;

  @override
  Future<List<PickedFile>> pickAttachments() async => next;
  @override
  Future<PickedFile?> pickDataFile() async => dataFile;
  @override
  Future<bool> save(String name, String text) async {
    saved = text;
    return true;
  }
}

PickedFile _file(String name, String text) =>
    PickedFile(name: name, bytes: Uint8List.fromList(utf8.encode(text)));

Future<void> _launch(
  WidgetTester tester,
  MemoryNetwork network,
  _Picker picker, {
  MemorySecretStore? store,
  Size size = const Size(390, 844),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  await tester.pumpWidget(
    ReploidRoot(
      key: UniqueKey(),
      secrets: store ?? MemorySecretStore(),
      files: MemoryFileStore(),
      picker: picker,
      overrides: [memoryNetworkProvider.overrideWithValue(network)],
    ),
  );
  await tester.pump();
}

Future<void> _settle(WidgetTester tester) async {
  for (var i = 0; i < 40; i++) {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump(_step);
  }
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await _settle(tester);
}

Future<void> _start(WidgetTester tester) async {
  await _tap(tester, find.text(Strings.start));
  expect(find.text(Strings.chatsHeading), findsOneWidget);
}

Future<void> _newChat(WidgetTester tester) async {
  await _tap(tester, find.text(Strings.newChat).first);
  await tester.pumpAndSettle(_step);
}

Future<void> _answer(WidgetTester tester) async {
  for (var i = 0; i < 60; i++) {
    await tester.pump(_step);
  }
  await _settle(tester);
}

Future<void> _close(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump(const Duration(seconds: 1));
}

void main() {
  testWidgets('attach a file, remove one, and send with the other', (
    tester,
  ) async {
    final network = MemoryNetwork(latency: _step, chunkDelay: _step);
    final picker = _Picker();
    await _launch(tester, network, picker);
    await _start(tester);
    await _newChat(tester);

    picker.next = [_file('notes.txt', 'One.\n\nTwo.'), _file('b.md', 'Three')];
    await _tap(tester, find.text(Strings.attach));
    expect(find.text(Strings.removeFile('notes.txt')), findsOneWidget);
    await _tap(tester, find.text(Strings.removeFile('b.md')));
    expect(find.text(Strings.removeFile('b.md')), findsNothing);
    expect(
      find.textContaining(Strings.attachDisclosure),
      findsOneWidget,
      reason: 'says the files go with the prompt before Send',
    );

    picker.next = [_file('program.exe', 'x')];
    await _tap(tester, find.text(Strings.attach));
    expect(find.text(Strings.attachLimits), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Summarize');
    await tester.pump();
    await _tap(tester, find.text(Strings.send));
    await _answer(tester);
    expect(find.text('Summarize'), findsWidgets);
    expect(find.text(Strings.attached(['notes.txt'])), findsOneWidget);
    expect(network.delivered.single.$3, contains('D1:P2'));
    expect(find.textContaining('reploid-document-sources'), findsNothing);
    await _close(tester);
  });

  testWidgets('a lost answer can be checked for and shows its details', (
    tester,
  ) async {
    final network = MemoryNetwork(latency: _step, chunkDelay: _step);
    await _launch(tester, network, _Picker());
    await _start(tester);
    await _newChat(tester);
    network.simulateNext(AnswerBehavior.loseMidStream);
    await tester.enterText(find.byType(TextField), 'hello there');
    await tester.pump();
    await _tap(tester, find.text(Strings.send));
    await _answer(tester);
    expect(find.text(Strings.checkAnswer), findsOneWidget);

    await _tap(tester, find.text(Strings.checkAnswer));
    await _answer(tester);
    expect(find.text('You asked: hello there'), findsOneWidget);
    expect(find.text(Strings.checkAnswer), findsNothing);
    expect(network.delivered, hasLength(1));

    await _tap(tester, find.text(Strings.details));
    expect(find.text(Strings.receiptOk), findsOneWidget);
    expect(find.text(_peerA), findsOneWidget);
    await _close(tester);
  });

  testWidgets('a blocked computer stops being the named recipient', (
    tester,
  ) async {
    final network = MemoryNetwork(latency: _step, chunkDelay: _step);
    await _launch(tester, network, _Picker());
    await _start(tester);
    await _tap(tester, find.text(Strings.computers));
    await tester.pumpAndSettle(_step);
    await _tap(tester, find.text(Strings.block).first);
    expect(find.text(Strings.blockedHeading), findsOneWidget);
    expect(find.text(Strings.blockedLabel), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle(_step);

    await _newChat(tester);
    expect(find.textContaining('Sending to'), findsNothing);
    await _close(tester);
  });

  testWidgets('appearance, export and import in Settings', (tester) async {
    final network = MemoryNetwork(latency: _step, chunkDelay: _step);
    final picker = _Picker();
    final store = MemorySecretStore();
    await _launch(tester, network, picker, store: store);
    await _start(tester);
    await _tap(tester, find.text(Strings.settings));
    await tester.pumpAndSettle(_step);

    await _tap(tester, find.text(Strings.appearanceDark));
    expect(
      tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode,
      ThemeMode.dark,
    );
    expect(await store.read('reploid.appearance.v1'), 'dark');

    await _tap(tester, find.text(Strings.exportData));
    expect(find.text(Strings.exported(0, 0)), findsOneWidget);
    final exported = jsonDecode(picker.saved!) as Map<String, Object?>;
    expect(exported['schema'], 'poolday.local-data-export/v1');

    picker.dataFile = _file('other.json', '{"schema":"something else"}');
    await _tap(tester, find.text(Strings.importData));
    expect(find.text(Strings.importInvalid), findsOneWidget);

    picker.dataFile = _file(
      'reploid-data.json',
      jsonEncode({
        'schema': 'poolday.local-data-export/v1',
        'version': 1,
        'conversations': [
          {
            'id': 'imported-1',
            'title': 'From the web',
            'model': {
              'id': MemoryNetwork.smallModel,
              'name': 'Qwen',
              'identity': 'sha256:${'1' * 64}',
            },
            'messages': [
              {
                'id': 'm1',
                'role': 'user',
                'content': 'Hi',
                'status': 'completed',
              },
              {
                'id': 'm2',
                'role': 'assistant',
                'content': 'Hello',
                'status': 'completed',
              },
            ],
            'attempts': [
              {'id': 'a1', 'status': 'completed', 'responseId': 'm2'},
            ],
          },
        ],
      }),
    );
    await _tap(tester, find.text(Strings.importData));
    expect(find.text(Strings.importSummary(1, 0, 0, 0)), findsOneWidget);
    expect(network.requests, 0);
    await _tap(tester, find.text(Strings.importConfirm));
    expect(find.text(Strings.imported(1, 0, 0)), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle(_step);
    expect(find.text('From the web'), findsOneWidget);
    expect(network.requests, 0);
    await _close(tester);
  });

  testWidgets('a narrow phone with large text fits the new controls', (
    tester,
  ) async {
    final network = MemoryNetwork(latency: _step, chunkDelay: _step);
    final picker = _Picker();
    await _launch(
      tester,
      network,
      picker,
      size: const Size(320, 640),
      textScale: 2,
    );
    await _start(tester);
    await _newChat(tester);
    picker.next = [
      _file('a-file-with-a-rather-long-name-for-a-phone.txt', 'One'),
      _file('b.md', 'Two'),
    ];
    await _tap(tester, find.text(Strings.attach));
    expect(tester.takeException(), isNull);
    await _close(tester);
  });
}
