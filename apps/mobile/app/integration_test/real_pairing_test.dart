// The app on a real platform pairing with a real desktop over real
// signaling and real WebRTC, then asking only that desktop.
//
// tool/e2e_macos.sh --pairing starts the web client's native provider as an
// owner desktop in a pairing room. The app starts in a different, empty
// room, so reaching the desktop means joining its room from the link.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reploid_mobile/app/network_config.dart';
import 'package:reploid_mobile/infrastructure/device_stores.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/main.dart';

const _link = String.fromEnvironment('REPLOID_E2E_PAIRING_LINK');
const _desktop = String.fromEnvironment('REPLOID_EXPECT_PROVIDER');
const _label = String.fromEnvironment('REPLOID_EXPECT_LABEL');
const _expected = String.fromEnvironment('REPLOID_EXPECT_ANSWER');

Future<void> _until(
  WidgetTester tester,
  Finder finder, {
  Duration limit = const Duration(seconds: 60),
}) async {
  final end = DateTime.now().add(limit);
  while (finder.evaluate().isEmpty) {
    if (DateTime.now().isAfter(end)) {
      final shown = [
        for (final element in find.byType(Text).evaluate())
          (element.widget as Text).data,
      ];
      fail('Timed out waiting for $finder. On screen: $shown');
    }
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _arrive(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pump();
}

/// A desktop window that is not in front has no keyboard focus, so the
/// draft is written through the field's controller.
Future<void> _type(WidgetTester tester, String text) async {
  tester.widget<TextField>(find.byType(TextField)).controller!.text = text;
  await tester.pump();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('pair from a link and get an answer from that desktop only', (
    tester,
  ) async {
    expect(NetworkConfig.signaling, isNotNull);
    expect(_link, isNotEmpty, reason: 'run tool/e2e_macos.sh --pairing');
    await tester.pumpWidget(
      ReploidRoot(secrets: MemorySecretStore(), files: MemoryFileStore()),
    );
    await tester.pump();
    await _tap(tester, find.text(Strings.start));
    await _until(tester, find.text(Strings.chatsHeading));
    await _until(tester, find.text(Strings.online));

    await _tap(tester, find.text(Strings.computers));
    await _arrive(tester);
    // The room the app starts in is empty: the desktop is elsewhere.
    expect(find.text(Strings.noComputers), findsOneWidget);
    await _type(tester, _link);
    await _tap(tester, find.text(Strings.pairCheck));
    await _until(tester, find.text(Strings.connectTo(_label)));
    expect(find.text(_desktop), findsOneWidget);
    await _tap(tester, find.text(Strings.connect));
    await _until(tester, find.text(Strings.unpair));
    expect(find.text(_desktop), findsOneWidget);
    await _until(tester, find.text(Strings.online));

    await tester.pageBack();
    await _arrive(tester);
    await _tap(tester, find.text(Strings.newChat).first);
    await _until(tester, find.text(Strings.composerHint));
    await _arrive(tester);
    await _until(tester, find.text('${Strings.answerOn}: $_label'));
    expect(find.text(Strings.discloseDesktop(_label)), findsOneWidget);
    await _type(tester, 'What is the capital of France?');
    await _tap(tester, find.text(Strings.send));
    await _until(tester, find.text(_expected));
    await _until(
      tester,
      find.text(Strings.answeredBy(_desktop, verified: true)),
    );
  });
}
