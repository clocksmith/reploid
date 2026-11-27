import 'package:flutter/material.dart';
import 'package:ui/ui.dart';

import 'poolday_tokens.g.dart';

/// Reploid's colours, generated from the web product's design tokens
/// (`apps/poolday/styles/poolday/tokens.css` -> `poolday_tokens.g.dart`):
/// page, raised, inset, line, ink, muted, focus and status tones, dark by
/// default with a light alternative.
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
  seedColor: dark ? PooldayDarkTokens.focus : PooldayLightTokens.focus,
  brightness: dark ? Brightness.dark : Brightness.light,
  colorScheme: dark ? _Dark.scheme : _Light.scheme,
  spacing: const UiSpacing(
    gap: PooldayTokens.spacingGap,
    inset: PooldayTokens.spacingInset,
    contentWidth: PooldayTokens.contentWidth,
    controlRadius: PooldayTokens.controlRadius,
    panelRadius: PooldayTokens.panelRadius,
    pillRadius: PooldayTokens.pillRadius,
  ),
  controlRadius: PooldayTokens.controlRadius,
  panelRadius: PooldayTokens.panelRadius,
  pillRadius: PooldayTokens.pillRadius,
  borderThin: PooldayTokens.borderThin,
  borderThick: PooldayTokens.borderThick,
  displaySize: PooldayTokens.textDisplay,
  headingSize: PooldayTokens.textXl,
  titleSize: PooldayTokens.textLg,
  bodySize: PooldayTokens.spacingGap,
  smallSize: PooldayTokens.textSm,
  leadingTight: PooldayTokens.leadingTight,
  leadingSnug: PooldayTokens.leadingSnug,
  leadingRead: PooldayTokens.leadingRead,
  durationFastMs: PooldayTokens.durationFastMs,
);

abstract final class _Dark {
  static const scheme = ColorScheme(
    brightness: Brightness.dark,
    primary: PooldayDarkTokens.focus,
    onPrimary: PooldayDarkTokens.onPrimary,
    primaryContainer: Color(0xff1b3344),
    onPrimaryContainer: PooldayDarkTokens.ink,
    secondary: PooldayDarkTokens.secondary,
    onSecondary: PooldayDarkTokens.onPrimary,
    secondaryContainer: Color(0xff2d2540),
    onSecondaryContainer: PooldayDarkTokens.ink,
    tertiary: PooldayDarkTokens.statusReady,
    onTertiary: PooldayDarkTokens.onPrimary,
    tertiaryContainer: Color(0xff3b3214),
    onTertiaryContainer: Color(0xfffde68a),
    error: PooldayDarkTokens.statusError,
    onError: PooldayDarkTokens.onPrimary,
    errorContainer: Color(0xff4a1d27),
    onErrorContainer: Color(0xffffe4e6),
    surface: PooldayDarkTokens.page,
    onSurface: PooldayDarkTokens.ink,
    onSurfaceVariant: PooldayDarkTokens.muted,
    outline: PooldayDarkTokens.muted,
    outlineVariant: PooldayDarkTokens.line,
    surfaceContainerLowest: PooldayDarkTokens.raised,
    surfaceContainerLow: PooldayDarkTokens.raised,
    surfaceContainer: PooldayDarkTokens.inset,
    surfaceContainerHigh: Color(0xff22252a),
    surfaceContainerHighest: Color(0xff2a2d33),
    inverseSurface: PooldayDarkTokens.ink,
    onInverseSurface: PooldayDarkTokens.page,
    inversePrimary: Color(0xff0369a1),
  );
}

abstract final class _Light {
  static const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: PooldayLightTokens.focus,
    onPrimary: Color(0xffffffff),
    primaryContainer: Color(0xffe0e7ff),
    onPrimaryContainer: PooldayLightTokens.ink,
    secondary: Color(0xff7c3aed),
    onSecondary: Color(0xffffffff),
    secondaryContainer: Color(0xffede9fe),
    onSecondaryContainer: PooldayLightTokens.ink,
    tertiary: PooldayLightTokens.statusReady,
    onTertiary: Color(0xffffffff),
    tertiaryContainer: Color(0xfffef3c7),
    onTertiaryContainer: Color(0xff78350f),
    error: PooldayLightTokens.statusError,
    onError: Color(0xffffffff),
    errorContainer: Color(0xffffe4e6),
    onErrorContainer: Color(0xff881337),
    surface: PooldayLightTokens.page,
    onSurface: PooldayLightTokens.ink,
    onSurfaceVariant: PooldayLightTokens.muted,
    outline: PooldayLightTokens.muted,
    outlineVariant: PooldayLightTokens.line,
    surfaceContainerLowest: PooldayLightTokens.raised,
    surfaceContainerLow: PooldayLightTokens.raised,
    surfaceContainer: PooldayLightTokens.inset,
    surfaceContainerHigh: Color(0xffe6ebf4),
    surfaceContainerHighest: Color(0xffdde3ee),
    inverseSurface: PooldayLightTokens.ink,
    onInverseSurface: PooldayLightTokens.page,
    inversePrimary: Color(0xffa5b4fc),
  );
}
