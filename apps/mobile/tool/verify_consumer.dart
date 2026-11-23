import 'dart:convert';
import 'dart:io';

/// Uses an isolated copy: neither a parent workspace nor app internals can help.
Future<void> main(List<String> args) async {
  if (args.length != 1) {
    throw ArgumentError('Pass the Flutter executable path.');
  }
  final root = Directory.current;
  final temp = await Directory.systemTemp.createTemp(
    'reploid_mobile_consumer_',
  );
  try {
    for (final package in ['core', 'ui']) {
      final source = Directory('${root.path}/packages/$package');
      final destination = Directory('${temp.path}/packages/$package');
      await destination.create(recursive: true);
      // A copied package is independently consumable without workspace metadata.
      final spec = (await File(
        '${source.path}/pubspec.yaml',
      ).readAsString()).replaceAll('resolution: workspace\n', '');
      await File('${destination.path}/pubspec.yaml').writeAsString(spec);
      await for (final entity in Directory(
        '${source.path}/lib',
      ).list(recursive: true)) {
        if (entity is! File) continue;
        final relative = entity.path.substring(source.path.length + 1);
        final target = File('${destination.path}/$relative');
        await target.parent.create(recursive: true);
        await entity.copy(target.path);
      }
    }
    final app = await Directory('${temp.path}/consumer').create();
    await File('${app.path}/pubspec.yaml').writeAsString('''
name: independent_consumer
publish_to: none
environment:
  sdk: '>=3.13.0 <4.0.0'
dependencies:
  core:
    path: ../packages/core
  ui:
    path: ../packages/ui
  flutter:
    sdk: flutter
dev_dependencies:
  flutter_test:
    sdk: flutter
''');
    await Directory('${app.path}/test').create();
    await File('${app.path}/test/consumer_test.dart').writeAsString('''
import 'package:core/core.dart';
import 'package:ui/ui.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('public packages work in a separate app', (tester) async {
    final sessions = SessionCoordinator();
    await sessions.activate(const SessionIdentity('consumer'));
    await tester.pumpWidget(MaterialApp(
      theme: createUiTheme(seedColor: Colors.purple),
      home: const Scaffold(body: ContentCard(children: [
        SectionHeading(title: 'Independent consumer'),
        ActionButton(label: 'Consumer action', pendingLabel: 'Working', onPressed: null),
      ])),
    ));
    expect(find.text('Consumer action'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    final closing = sessions.dispose();
    await tester.pump();
    await closing;
  });
}
''');
    for (final arguments in [
      ['pub', 'get', '--offline'],
      ['test', '--no-pub', '--reporter', 'expanded'],
    ]) {
      final process = await Process.start(
        args.single,
        arguments,
        workingDirectory: app.path,
      );
      await Future.wait([
        stdout.addStream(process.stdout),
        stderr.addStream(process.stderr),
      ]);
      final result = await process.exitCode;
      if (result != 0) {
        throw StateError('Consumer check failed: ${jsonEncode(arguments)}');
      }
    }
    stdout.writeln(
      'Independent consumer passed using public core and ui imports.',
    );
  } finally {
    await temp.delete(recursive: true);
  }
}
