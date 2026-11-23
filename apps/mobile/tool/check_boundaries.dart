import 'dart:convert';
import 'dart:io';

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/visitor.dart';
import 'package:path/path.dart' as p;
import 'package:yaml/yaml.dart';

/// Policy and dependency checks use parsed directives, including every platform
/// alternative. Comments, literals and import aliases cannot hide an edge.
List<String> checkSources(
  Map<String, String> sources,
  Map<String, dynamic> policy,
) {
  final errors = <String>[];
  final layers = (policy['layers'] as Map).cast<String, Map>();
  final packages = (policy['workspacePackages'] as Map).cast<String, String>();
  final entries = (policy['publicEntries'] as Map).cast<String, String>();
  final graph = <String, Set<String>>{};
  String? owner(String path) {
    for (final entry in layers.entries) {
      if ((entry.value['paths'] as List).any(
        (pattern) => RegExp(pattern as String).hasMatch(path),
      )) {
        return entry.key;
      }
    }
    return null;
  }

  String? feature(String path) =>
      RegExp(r'^app/lib/features/([^/]+)/').firstMatch(path)?.group(1);
  String? package(String path) {
    for (final entry in packages.entries) {
      if (path.startsWith(entry.value)) return entry.key;
    }
    return null;
  }

  for (final path in sources.keys.toList()..sort()) {
    final layer = owner(path);
    graph[path] = {};
    if (layer == null) {
      errors.add(
        '$path: no architectural owner; classify this path in tool/architecture.json',
      );
      continue;
    }
    final rules = layers[layer]!;
    final result = parseString(
      content: sources[path]!,
      path: path,
      throwIfDiagnostics: false,
    );
    for (final error in result.errors) {
      errors.add(
        '$path:${result.lineInfo.getLocation(error.offset).lineNumber}: syntax: ${error.message}',
      );
    }
    for (final directive in result.unit.directives) {
      final uris = <StringLiteral>[];
      if (directive is UriBasedDirective) uris.add(directive.uri);
      if (directive is ImportDirective) {
        uris.addAll(directive.configurations.map((item) => item.uri));
      }
      if (directive is ExportDirective) {
        uris.addAll(directive.configurations.map((item) => item.uri));
      }
      for (final literal in uris) {
        final raw = literal.stringValue;
        final location =
            '$path:${result.lineInfo.getLocation(literal.offset).lineNumber}';
        void reject(String message) => errors.add('$location: $message ($raw)');
        if (raw == null) {
          reject('nonliteral dependency');
          continue;
        }
        final uri = Uri.tryParse(raw);
        if (uri == null) {
          reject('invalid dependency');
          continue;
        }
        if (uri.scheme == 'dart') {
          final device = (policy['deviceLibraries'] as List).contains(uri.path);
          if (!(policy['dartLibraries'] as List).contains(uri.path) &&
              !(device && rules['deviceAccess'] == true)) {
            reject('SDK/device access is not owned by $layer');
          }
          continue;
        }
        String? target;
        if (uri.scheme == 'package') {
          final segments = uri.pathSegments;
          final root = segments.isEmpty ? null : packages[segments.first];
          if (directive is ExportDirective && root == null) {
            reject(
              'external package re-exports hide ownership; expose your own API',
            );
          }
          if (root != null) {
            target = p.posix.normalize('$root${segments.skip(1).join('/')}');
          } else {
            if (!(rules['packages'] as List).contains(uri.path)) {
              reject('external dependency is not allowed in $layer');
            }
            if ((layer == 'presentation' || layer == 'composition') &&
                uri.path.startsWith('flutter/')) {
              final combinators = directive is ImportDirective
                  ? directive.combinators
                  : <Combinator>[];
              final names = combinators
                  .whereType<ShowCombinator>()
                  .expand((item) => item.shownNames)
                  .map((item) => item.name)
                  .toList();
              if (names.isEmpty ||
                  combinators.any((item) => item is HideCombinator) ||
                  names.any(
                    (name) =>
                        !(policy[layer == 'presentation'
                                    ? 'presentationFrameworkSymbols'
                                    : 'compositionFrameworkSymbols']
                                as List)
                            .contains(name),
                  )) {
                reject(
                  '$layer must explicitly show only framework lifecycle types',
                );
              }
            }
            continue;
          }
        } else if (uri.scheme.isEmpty &&
            !uri.hasAuthority &&
            !p.posix.isAbsolute(uri.path)) {
          target = p.posix.normalize(
            p.posix.join(p.posix.dirname(path), uri.path),
          );
        } else {
          reject('dependency must be a Dart, package, or relative library');
          continue;
        }
        if (!sources.containsKey(target)) {
          reject('dependency leaves checked source roots or does not exist');
          continue;
        }
        graph[path]!.add(target);
        final targetLayer = owner(target);
        if (!(rules['dependsOn'] as List).contains(targetLayer)) {
          reject('$layer cannot depend on $targetLayer');
        }
        final sourcePackage = package(path), targetPackage = package(target);
        if (sourcePackage != targetPackage &&
            entries.containsKey(targetPackage) &&
            (uri.scheme != 'package' ||
                target !=
                    '${packages[targetPackage]}${entries[targetPackage]}')) {
          reject('cross-package dependency must use the public package entry');
        }
        final sourceFeature = feature(path), targetFeature = feature(target);
        if (sourceFeature != null &&
            targetFeature != null &&
            sourceFeature != targetFeature) {
          reject(
            'cross-feature dependency requires an explicit shared contract',
          );
        }
        if (directive is PartDirective && targetLayer != layer) {
          reject('parts must have the same owner');
        }
      }
    }
    if (rules['deviceAccess'] != true) {
      result.unit.accept(
        _VisualVisitor((policy['deviceSymbols'] as List).cast<String>().toSet(), (
          node,
          name,
        ) {
          errors.add(
            '$path:${result.lineInfo.getLocation(node.offset).lineNumber}: device access belongs to infrastructure ($name)',
          );
        }),
      );
    }
    if (layer == 'presentation' || layer == 'composition') {
      result.unit.accept(
        _VisualVisitor((policy['visualSymbols'] as List).cast<String>().toSet(), (
          node,
          name,
        ) {
          errors.add(
            '$path:${result.lineInfo.getLocation(node.offset).lineNumber}: visual ownership belongs to ui/design, not $layer ($name)',
          );
        }),
      );
    }
  }
  final visited = <String>{}, active = <String>{}, stack = <String>[];
  void visit(String file) {
    if (active.contains(file)) {
      errors.add(
        'dependency cycle: ${[...stack.sublist(stack.indexOf(file)), file].join(' -> ')}',
      );
      return;
    }
    if (!visited.add(file)) return;
    active.add(file);
    stack.add(file);
    for (final next in (graph[file] ?? <String>{}).toList()..sort()) {
      visit(next);
    }
    stack.removeLast();
    active.remove(file);
  }

  for (final file in graph.keys.toList()..sort()) {
    visit(file);
  }
  return errors..sort();
}

class _VisualVisitor extends RecursiveAstVisitor<void> {
  _VisualVisitor(this.symbols, this.report);
  final Set<String> symbols;
  final void Function(AstNode, String) report;

  @override
  void visitSimpleIdentifier(SimpleIdentifier node) {
    if (symbols.contains(node.name)) report(node, node.name);
    super.visitSimpleIdentifier(node);
  }

  // Constructor types are represented by NamedType tokens, not identifiers.
  @override
  void visitNamedType(NamedType node) {
    if (symbols.contains(node.name.lexeme)) report(node, node.name.lexeme);
    super.visitNamedType(node);
  }
}

/// Workspace additions must enter the same checked graph. Pure packages cannot
/// acquire hidden runtime framework/device dependencies through their manifests.
List<String> checkManifests(
  Map<String, Map> manifests,
  Map<String, dynamic> policy,
) {
  final errors = <String>[];
  final configured = (policy['workspacePackages'] as Map)
      .cast<String, String>();
  final actual = (manifests['pubspec.yaml']?['workspace'] as List? ?? [])
      .map((path) => '${p.posix.normalize(path as String)}/lib/')
      .toSet();
  if (actual.length != configured.length ||
      !actual.containsAll(configured.values)) {
    errors.add(
      'workspace packages must match tool/architecture.json source roots',
    );
  }
  final layers = policy['layers'] as Map;
  for (final name in ['core', 'ui']) {
    final root = p.posix.dirname(
      configured[name]!.replaceFirst(RegExp(r'/$'), ''),
    );
    final spec = manifests['$root/pubspec.yaml'];
    if (spec == null || spec['name'] != name) {
      errors.add('$root/pubspec.yaml: missing package or mismatched name');
      continue;
    }
    final allowed = ((layers[name] as Map)['packages'] as List)
        .map((uri) => (uri as String).split('/').first)
        .toSet();
    for (final dependency in (spec['dependencies'] as Map? ?? {}).keys) {
      if (!allowed.contains(dependency)) {
        errors.add(
          '$root/pubspec.yaml: runtime dependency $dependency is not owned by $name',
        );
      }
    }
  }
  return errors..sort();
}

void main() {
  final policy = jsonDecode(
    File('tool/architecture.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final sources = <String, String>{};
  final errors = <String>[];
  for (final root
      in (policy['workspacePackages'] as Map).values.cast<String>()) {
    for (final entry in Directory(
      root,
    ).listSync(recursive: true, followLinks: false)) {
      if (entry is Link) {
        errors.add(
          '${entry.path}: source symlinks are not checked; use a regular file',
        );
      }
      if (entry is File && entry.path.endsWith('.dart')) {
        sources[p.posix.normalize(entry.path)] = entry.readAsStringSync();
      }
    }
  }
  final manifests = <String, Map>{};
  for (final path in [
    'pubspec.yaml',
    'packages/core/pubspec.yaml',
    'packages/ui/pubspec.yaml',
  ]) {
    manifests[path] = loadYaml(File(path).readAsStringSync()) as Map;
  }
  errors.addAll(checkManifests(manifests, policy));
  errors.addAll(checkSources(sources, policy));
  if (errors.isNotEmpty) {
    stderr.writeln(errors.join('\n'));
    exitCode = 1;
  } else {
    stdout.writeln(
      'Architecture passed: ${sources.length} files; layer imports, public entries, cycles, visual and device ownership.',
    );
  }
}
