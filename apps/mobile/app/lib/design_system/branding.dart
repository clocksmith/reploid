import 'package:flutter/material.dart';
import 'package:ui/ui.dart';

/// Reploid's colours, translated from the web product's design tokens
/// (`apps/poolday/styles/poolday/tokens.css`): page, raised, inset, line,
/// ink, muted and focus, dark by default with a light alternative.
///
/// The web tokens name no container roles. The container colours here are
/// this app's choice, mixed from the page and accent tokens so that text on
/// them keeps the token ink colour.
/// Null follows the system.
ThemeMode themeModeFor({bool? dark}) => dark == null
    ? ThemeMode.system
    : dark
    ? ThemeMode.dark
    : ThemeMode.light;

ThemeData appTheme({bool dark = false}) => createUiTheme(
  seedColor: dark ? _Dark.focus : _Light.focus,
  brightness: dark ? Brightness.dark : Brightness.light,
  colorScheme: dark ? _Dark.scheme : _Light.scheme,
  spacing: const UiSpacing(gap: 16, inset: 16, contentWidth: 720),
  controlRadius: 10,
  panelRadius: 16,
);

abstract final class _Dark {
  static const page = Color(0xff141619);
  static const raised = Color(0xff1c1e22);
  static const inset = Color(0xff101215);
  static const line = Color(0xff2a2c2f);
  static const ink = Color(0xfff8fafc);
  static const muted = Color(0xff94a3b8);
  static const focus = Color(0xff38bdf8);
  static const onAccent = Color(0xff030712);

  static const scheme = ColorScheme(
    brightness: Brightness.dark,
    primary: focus,
    onPrimary: onAccent,
    primaryContainer: Color(0xff1b3344),
    onPrimaryContainer: ink,
    secondary: Color(0xffc084fc),
    onSecondary: onAccent,
    secondaryContainer: Color(0xff2d2540),
    onSecondaryContainer: ink,
    tertiary: Color(0xff34d399),
    onTertiary: onAccent,
    tertiaryContainer: Color(0xff3b3214),
    onTertiaryContainer: Color(0xfffde68a),
    error: Color(0xfffb7185),
    onError: onAccent,
    errorContainer: Color(0xff4a1d27),
    onErrorContainer: Color(0xffffe4e6),
    surface: page,
    onSurface: ink,
    onSurfaceVariant: muted,
    outline: muted,
    outlineVariant: line,
    surfaceContainerLowest: raised,
    surfaceContainerLow: raised,
    surfaceContainer: inset,
    surfaceContainerHigh: Color(0xff22252a),
    surfaceContainerHighest: Color(0xff2a2d33),
    inverseSurface: ink,
    onInverseSurface: page,
    inversePrimary: Color(0xff0369a1),
  );
}

abstract final class _Light {
  static const page = Color(0xffeef2f9);
  static const raised = Color(0xffffffff);
  static const inset = Color(0xfff7f9fd);
  static const line = Color(0xffd9dee8);
  static const ink = Color(0xff0f172a);
  static const muted = Color(0xff475569);
  static const focus = Color(0xff4f46e5);

  static const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: focus,
    onPrimary: Color(0xffffffff),
    primaryContainer: Color(0xffe0e7ff),
    onPrimaryContainer: ink,
    secondary: Color(0xff7c3aed),
    onSecondary: Color(0xffffffff),
    secondaryContainer: Color(0xffede9fe),
    onSecondaryContainer: ink,
    tertiary: Color(0xff047857),
    onTertiary: Color(0xffffffff),
    tertiaryContainer: Color(0xfffef3c7),
    onTertiaryContainer: Color(0xff78350f),
    error: Color(0xffbe123c),
    onError: Color(0xffffffff),
    errorContainer: Color(0xffffe4e6),
    onErrorContainer: Color(0xff881337),
    surface: page,
    onSurface: ink,
    onSurfaceVariant: muted,
    outline: muted,
    outlineVariant: line,
    surfaceContainerLowest: raised,
    surfaceContainerLow: raised,
    surfaceContainer: inset,
    surfaceContainerHigh: Color(0xffe6ebf4),
    surfaceContainerHighest: Color(0xffdde3ee),
    inverseSurface: ink,
    onInverseSurface: page,
    inversePrimary: Color(0xffa5b4fc),
  );
}
