// Exercises the default ReploidRoot() on macOS with the real platform Keychain
// (SecureSecretStore) and private support directory (DirectoryFileStore),
// proving Start succeeds without macOS Keychain error -34018 and Forget cleans
// up the stored key and archive.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/main.dart';

Future<void> _until(
  WidgetTester tester,
  Finder finder, {
  Duration limit = const Duration(seconds: 30),
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

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'default ReploidRoot starts with real macOS Keychain and forgets cleanly',
    (tester) async {
      await tester.pumpWidget(const ReploidRoot());
      await tester.pump();

      // If a prior identity already existed, go straight to Chats; otherwise tap Start.
      await _arrive(tester);
      if (find.text(Strings.start).evaluate().isNotEmpty) {
        await _tap(tester, find.text(Strings.start));
      }
      await _until(tester, find.text(Strings.chatsHeading));
      expect(find.text(Strings.sessionFailure), findsNothing);

      // Create a chat and send one prompt so DirectoryFileStore writes an archive
      // and exercises the macOS backup-exclusion channel.
      await _tap(tester, find.text(Strings.newChat).first);
      await _until(tester, find.text(Strings.composerHint));
      await _arrive(tester);
      tester.widget<TextField>(find.byType(TextField)).controller!.text =
          'Keychain launch smoke check';
      await tester.pump();
      await _tap(tester, find.text(Strings.send));
      await _until(tester, find.text('You asked: Keychain launch smoke check'));

      await tester.pageBack();
      await _arrive(tester);

      // Clean up with Forget this device so no test key remains in Keychain.
      await _tap(tester, find.text(Strings.settings));
      await _arrive(tester);
      await _tap(tester, find.text(Strings.forget));
      await _until(tester, find.text(Strings.start));
      await _arrive(tester);
    },
  );
}
