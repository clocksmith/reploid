import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';

import '../check_boundaries.dart';

void main() {
  final policy = jsonDecode(
    File('tool/architecture.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  List<String> check(Map<String, String> source) =>
      checkSources(source, policy);
  const domain = 'app/lib/features/tasks/domain/task.dart';
  const app = 'app/lib/features/tasks/application/complete.dart';
  const adapter = 'app/lib/features/tasks/infrastructure/api.dart';
  const screen = 'app/lib/features/tasks/presentation/screen.dart';

  test('valid inward dependencies and public package entries pass', () {
    expect(
      check({
        'packages/core/lib/core.dart': "export 'src/failure.dart';",
        'packages/core/lib/src/failure.dart': 'class Failure {}',
        domain: "import 'package:core/core.dart';",
        app: "import '../domain/task.dart';",
        adapter: "import '../domain/task.dart'; import 'dart:io';",
        screen: "import '../application/complete.dart'; import '../domain/task.dart';",
        'app/lib/app/wiring.dart':
            "import '../features/tasks/infrastructure/api.dart';",
      }),
      isEmpty,
    );
  });

  test(
    'comments and string literals cannot manufacture imports or styling',
    () {
      expect(
        check({
          domain: '''
// import 'package:flutter/material.dart';
/* export 'dart:io'; */
const documentation = "import 'dart:io'; TextStyle Color";
''',
        }),
        isEmpty,
      );
    },
  );

  for (final entry in {
    'domain to UI': (domain, "import 'package:flutter/material.dart';"),
    'domain to provider': (
      domain,
      "import 'package:flutter_riverpod/flutter_riverpod.dart';",
    ),
    'domain to device': (domain, "import 'dart:io';"),
    'application to device': (app, "import 'dart:ffi';"),
    'presentation to device': (screen, "import 'dart:io';"),
    'composition to device': (
      'app/lib/app/wiring.dart',
      "import 'package:flutter/services.dart';",
    ),
    'infrastructure to visuals': (
      adapter,
      "import 'package:flutter/material.dart';",
    ),
    'ui to provider': (
      'packages/ui/lib/ui.dart',
      "import 'package:flutter_riverpod/flutter_riverpod.dart';",
    ),
    'unknown external dependency': (
      screen,
      "import 'package:device_plugin/device_plugin.dart';",
    ),
  }.entries) {
    test(
      'rejects ${entry.key}',
      () => expect(check({entry.value.$1: entry.value.$2}), isNotEmpty),
    );
  }

  test('all conditional import and export alternatives are checked', () {
    for (final directive in ['import', 'export']) {
      expect(
        check({
          domain: "$directive 'dart:async' if (dart.library.io) 'dart:io';",
        }),
        contains(contains('SDK/device access')),
      );
    }
  });

  test('application and presentation cannot reach concrete adapters', () {
    for (final path in [app, screen]) {
      expect(
        check({path: "import '../infrastructure/api.dart';", adapter: ''}),
        contains(contains('cannot depend on infrastructure')),
      );
    }
  });

  test('presentation cannot reach composition through a barrel', () {
    expect(
      check({
        screen: "import 'barrel.dart';",
        'app/lib/features/tasks/presentation/barrel.dart':
            "export '../../../app/wiring.dart';",
        'app/lib/app/wiring.dart': '',
      }),
      contains(contains('presentation cannot depend on composition')),
    );
  });

  test(
    'cross-package internals are blocked for relative and package imports',
    () {
      for (final uri in [
        'package:core/src/failure.dart',
        '../../../../packages/core/lib/src/failure.dart',
      ]) {
        expect(
          check({
            'app/lib/app/wiring.dart': "import '$uri';",
            'packages/core/lib/src/failure.dart': '',
          }),
          isNotEmpty,
        );
      }
    },
  );

  test('package path traversal cannot reach internal APIs', () {
    expect(
      check({
        'packages/ui/lib/ui.dart':
            "import 'package:core/src/../src/failure.dart';",
        'packages/core/lib/src/failure.dart': '',
      }),
      contains(contains('public package entry')),
    );
  });

  test('cross-feature imports are blocked', () {
    expect(
      check({
        domain: "import '../../other/domain/model.dart';",
        'app/lib/features/other/domain/model.dart': '',
      }),
      contains(contains('cross-feature dependency')),
    );
  });

  test('cycles include exports and are reported deterministically', () {
    final source = {
      domain: "export 'other.dart';",
      'app/lib/features/tasks/domain/other.dart': "import 'task.dart';",
    };
    final errors = check(source);
    expect(errors, contains(contains('dependency cycle:')));
    expect(check(Map.fromEntries(source.entries.toList().reversed)), errors);
  });

  test('presentation framework imports need a narrow lifecycle show list', () {
    expect(
      check({
        screen:
            "import 'package:flutter/widgets.dart' show Widget, BuildContext;",
      }),
      isEmpty,
    );
    for (final suffix in ['', ' show Widget, Text', ' hide Text']) {
      expect(
        check({screen: "import 'package:flutter/widgets.dart'$suffix;"}),
        contains(contains('explicitly show')),
      );
    }
  });

  test(
    'visual policy catches prefixed types, constructors and static styling',
    () {
      for (final snippet in [
        'final x = const paint.Color(0xff000000);',
        'final x = paint.EdgeInsets.all(12);',
        'paint.TextStyle? x;',
        'final x = Theme.of(context);',
        'final x = Container();',
      ]) {
        for (final path in [screen, 'app/lib/app/wiring.dart']) {
          expect(
            check({path: snippet}),
            contains(contains('visual ownership')),
          );
        }
      }
    },
  );

  test('visual APIs and animations belong to the design owner', () {
    expect(
      check({
        'packages/ui/lib/src/component.dart': "import 'package:flutter/material.dart'; final x = const Color(0xff000000);",
      }),
      isEmpty,
    );
  });

  test('parts cannot be used to move declarations across owners', () {
    expect(
      check({
        domain: "part '../infrastructure/api.dart';",
        adapter: "part of '../domain/task.dart';",
      }),
      contains(contains('parts must have the same owner')),
    );
  });

  test('new source directories and unresolved local edges fail closed', () {
    expect(
      check({'app/lib/misc/leak.dart': ''}),
      contains(contains('no architectural owner')),
    );
    expect(
      check({domain: "import 'missing.dart';"}),
      contains(contains('does not exist')),
    );
    expect(check({domain: "import 'file:///tmp/escape.dart';"}), isNotEmpty);
  });

  test('malformed syntax cannot silently bypass the checker', () {
    expect(check({domain: "import 'broken"}), contains(contains('syntax:')));
  });
  test(
    'device APIs re-exported by Flutter are still confined to infrastructure',
    () {
      for (final path in [
        screen,
        'app/lib/app/wiring.dart',
        'packages/ui/lib/src/component.dart',
      ]) {
        expect(
          check({path: 'void copy() => Clipboard.setData(value);'}),
          contains(contains('device access belongs to infrastructure')),
        );
      }
    },
  );

  test('composition imports expose lifecycle and navigation, not visual primitives', () {
    expect(
      check({
        'app/lib/app/wiring.dart': "import 'package:flutter/material.dart' show MaterialApp, Navigator;",
      }),
      isEmpty,
    );
    expect(
      check({
        'app/lib/app/wiring.dart':
            "import 'package:flutter/material.dart' show Color;",
      }),
      contains(contains('explicitly show')),
    );
  });

  test(
    'design barrels cannot re-export an external framework into consumers',
    () {
      expect(
        check({
          'packages/ui/lib/ui.dart': "export 'package:flutter/material.dart';",
        }),
        contains(contains('external package re-exports')),
      );
    },
  );
  test('workspace manifests cannot introduce unchecked packages or framework dependencies', () {
    final manifests = <String, Map>{
      'pubspec.yaml': {
        'workspace': ['packages/core', 'packages/ui', 'app'],
      },
      'packages/core/pubspec.yaml': {'name': 'core'},
      'packages/ui/pubspec.yaml': {
        'name': 'ui',
        'dependencies': {
          'flutter': {'sdk': 'flutter'},
        },
      },
    };
    expect(checkManifests(manifests, policy), isEmpty);
    manifests['packages/core/pubspec.yaml']!['dependencies'] = {
      'flutter': {'sdk': 'flutter'},
    };
    expect(
      checkManifests(manifests, policy),
      contains(contains('runtime dependency flutter')),
    );
    manifests['packages/core/pubspec.yaml']!.remove('dependencies');
    manifests['packages/ui/pubspec.yaml']!['dependencies'] = {
      'core': {'path': '../core'},
    };
    expect(
      checkManifests(manifests, policy),
      contains(contains('runtime dependency core')),
    );
    (manifests['pubspec.yaml']!['workspace'] as List).add('packages/unchecked');
    expect(
      checkManifests(manifests, policy),
      contains(contains('workspace packages must match')),
    );
  });
}
