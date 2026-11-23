// The app on a real platform, asking over real signaling and real WebRTC.
//
// tool/e2e_macos.sh starts tests/fixtures/requester-conformance/
// webrtc-provider.js (the web client's signaling server and native provider
// with a stub model) and passes its room to this test through dart-defines.
// Nothing about the transport is faked here.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reploid_mobile/app/network_config.dart';
import 'package:reploid_mobile/infrastructure/identity_store.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/main.dart';

const _expected = String.fromEnvironment('REPLOID_EXPECT_ANSWER');
const _provider = String.fromEnvironment('REPLOID_EXPECT_PROVIDER');

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

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pump();
  await tester.tap(finder);
  await tester.pump();
}

/// Lets a page transition finish. A page that is still sliding in ignores
/// taps, and a loading bar would keep pumpAndSettle waiting forever.
Future<void> _arrive(WidgetTester tester) async {
  for (var i = 0; i < 8; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Writes the draft through the field's controller. A desktop window that
/// is not in front has no keyboard focus, so simulated typing never lands.
Future<void> _type(WidgetTester tester, String text) async {
  tester.widget<TextField>(find.byType(TextField)).controller!.text = text;
  await tester.pump();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a prompt is answered by a real provider over WebRTC', (
    tester,
  ) async {
    expect(
      NetworkConfig.signaling,
      isNotNull,
      reason: 'run through tool/e2e_macos.sh, which supplies the room',
    );
    await tester.pumpWidget(ReploidRoot(identityStore: MemoryIdentityStore()));
    await tester.pump();
    expect(find.text(Strings.demoNetwork), findsNothing);
    await _tap(tester, find.text(Strings.start));
    await _until(tester, find.text(Strings.chatsHeading));
    await _until(tester, find.text(Strings.online));

    // The provider is listed with the identity it proved.
    await _tap(tester, find.text(Strings.computers));
    await _arrive(tester);
    await _until(tester, find.text(_provider));
    expect(find.text(Strings.ready), findsOneWidget);
    await tester.pageBack();
    await _arrive(tester);

    await _tap(tester, find.text(Strings.newChat).first);
    await _until(tester, find.text(Strings.composerHint));
    await _arrive(tester);
    await _type(tester, 'What is the capital of France?');
    await _tap(tester, find.text(Strings.send));
    await _until(tester, find.text(_expected));
    await _until(
      tester,
      find.text(Strings.answeredBy(_provider, verified: true)),
    );
    expect(find.text(Strings.send), findsOneWidget);

    // A second turn on the same connection.
    await _type(tester, 'And again?');
    await _tap(tester, find.text(Strings.send));
    await _until(
      tester,
      find.text(_expected).evaluate().length == 2
          ? find.text(_expected)
          : find.text('never'),
      limit: const Duration(seconds: 1),
    ).catchError((_) {});
    await _until(
      tester,
      find.byWidgetPredicate(
        (w) =>
            w is Text &&
            w.data == Strings.answeredBy(_provider, verified: true),
      ),
    );
    await tester.pump(const Duration(seconds: 2));
    expect(find.text(_expected), findsNWidgets(2));
  });
}
