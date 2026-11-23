import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:reploid_mobile/l10n/strings.dart';
import 'package:reploid_mobile/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  testWidgets('complete a task and switch accounts on a device', (
    tester,
  ) async {
    app.main();
    await tester.pumpAndSettle();
    await tester.tap(find.text(Strings.accountA));
    await tester.pumpAndSettle();
    await tester.tap(find.text('A: Plan the first release'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Device journey');
    await tester.tap(find.text(Strings.complete));
    await tester.pumpAndSettle();
    expect(find.text(Strings.completed), findsOneWidget);
    await tester.tap(find.text(Strings.accountB));
    await tester.pumpAndSettle();
    expect(find.text('B: Plan the first release'), findsOneWidget);
    expect(find.text('Device journey'), findsNothing);
  });
}
