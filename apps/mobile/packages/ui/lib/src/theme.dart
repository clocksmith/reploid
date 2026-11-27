import 'package:flutter/material.dart';

/// Layout and shape roles replaced by each app's design system.
@immutable
final class UiSpacing extends ThemeExtension<UiSpacing> {
  const UiSpacing({
    this.gap = 16,
    this.inset = 24,
    this.contentWidth = 760,
    this.controlRadius = 10,
    this.panelRadius = 16,
    this.pillRadius = 999,
  });

  final double gap;
  final double inset;
  final double contentWidth;
  final double controlRadius;
  final double panelRadius;
  final double pillRadius;

  static UiSpacing of(BuildContext context) =>
      Theme.of(context).extension<UiSpacing>() ?? const UiSpacing();

  @override
  UiSpacing copyWith({
    double? gap,
    double? inset,
    double? contentWidth,
    double? controlRadius,
    double? panelRadius,
    double? pillRadius,
  }) => UiSpacing(
    gap: gap ?? this.gap,
    inset: inset ?? this.inset,
    contentWidth: contentWidth ?? this.contentWidth,
    controlRadius: controlRadius ?? this.controlRadius,
    panelRadius: panelRadius ?? this.panelRadius,
    pillRadius: pillRadius ?? this.pillRadius,
  );

  @override
  UiSpacing lerp(covariant UiSpacing? other, double t) => other == null
      ? this
      : UiSpacing(
          gap: gap + (other.gap - gap) * t,
          inset: inset + (other.inset - inset) * t,
          contentWidth: contentWidth + (other.contentWidth - contentWidth) * t,
          controlRadius:
              controlRadius + (other.controlRadius - controlRadius) * t,
          panelRadius: panelRadius + (other.panelRadius - panelRadius) * t,
          pillRadius: pillRadius + (other.pillRadius - pillRadius) * t,
        );
}

/// Apps own font assets and branding; all components share these state styles.
///
/// Pass [colorScheme] when the app's design system names every colour role
/// itself; otherwise the roles are derived from [seedColor].
ThemeData createUiTheme({
  required Color seedColor,
  Brightness brightness = Brightness.light,
  UiSpacing spacing = const UiSpacing(),
  String? fontFamily,
  ColorScheme? colorScheme,
  double controlRadius = 10,
  double panelRadius = 16,
  double pillRadius = 999,
  double borderThin = 1,
  double borderThick = 2,
  double displaySize = 32,
  double headingSize = 24,
  double titleSize = 18,
  double bodySize = 16,
  double smallSize = 14,
  double leadingTight = 1.2,
  double leadingSnug = 1.4,
  double leadingRead = 1.6,
  int durationFastMs = 160,
}) {
  final colors =
      colorScheme ??
      ColorScheme.fromSeed(
        seedColor: seedColor,
        brightness: brightness,
        surface: brightness == Brightness.light
            ? const Color(0xfff8f8f5)
            : const Color(0xff151917),
      );
  final resolvedSpacing = spacing.copyWith(
    controlRadius: controlRadius,
    panelRadius: panelRadius,
    pillRadius: pillRadius,
  );
  final base = ThemeData(
    useMaterial3: true,
    colorScheme: colors,
    fontFamily: fontFamily,
    extensions: [resolvedSpacing],
  );
  final shape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(controlRadius),
  );
  WidgetStateProperty<Color?> overlay(Color color) =>
      WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.disabled)) return Colors.transparent;
        if (states.contains(WidgetState.pressed)) {
          return color.withValues(alpha: .16);
        }
        if (states.contains(WidgetState.focused)) {
          return color.withValues(alpha: .12);
        }
        if (states.contains(WidgetState.hovered)) {
          return color.withValues(alpha: .07);
        }
        return Colors.transparent;
      });
  final button = ButtonStyle(
    minimumSize: const WidgetStatePropertyAll(Size(48, 52)),
    padding: const WidgetStatePropertyAll(
      EdgeInsets.symmetric(horizontal: 22, vertical: 14),
    ),
    shape: WidgetStatePropertyAll(shape),
    animationDuration: Duration(milliseconds: durationFastMs),
    textStyle: WidgetStatePropertyAll(
      base.textTheme.labelLarge?.copyWith(
        fontSize: smallSize,
        fontWeight: FontWeight.w600,
        letterSpacing: .1,
      ),
    ),
    side: WidgetStateProperty.resolveWith(
      (states) => BorderSide(
        color: states.contains(WidgetState.focused)
            ? colors.primary
            : Colors.transparent,
        width: borderThick,
      ),
    ),
  );
  return base.copyWith(
    scaffoldBackgroundColor: colors.surface,
    hoverColor: colors.primary.withValues(alpha: .05),
    focusColor: colors.primary.withValues(alpha: .12),
    splashColor: colors.primary.withValues(alpha: .12),
    highlightColor: colors.primary.withValues(alpha: .04),
    textTheme: base.textTheme.copyWith(
      headlineLarge: base.textTheme.headlineLarge?.copyWith(
        fontSize: displaySize,
        height: leadingTight,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.8,
      ),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(
        fontSize: headingSize,
        height: leadingTight,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.4,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontSize: titleSize,
        height: leadingSnug,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
      ),
      bodyLarge: base.textTheme.bodyLarge?.copyWith(
        fontSize: bodySize,
        height: leadingRead,
      ),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(
        fontSize: smallSize,
        height: leadingRead,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: colors.surface,
      foregroundColor: colors.onSurface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: 72,
      titleSpacing: 24,
      centerTitle: false,
      titleTextStyle: base.textTheme.titleMedium?.copyWith(
        fontSize: titleSize,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
      ),
    ),
    cardTheme: CardThemeData(
      color: colors.surfaceContainerLowest,
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(panelRadius),
        side: BorderSide(
          color: colors.outlineVariant.withValues(alpha: .6),
          width: borderThin,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: button.copyWith(
        overlayColor: overlay(colors.onPrimary),
        side: WidgetStateProperty.resolveWith(
          (states) => BorderSide(
            color: states.contains(WidgetState.focused)
                ? colors.onPrimary
                : Colors.transparent,
            width: borderThick,
          ),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: button.copyWith(
        overlayColor: overlay(colors.primary),
        side: WidgetStateProperty.resolveWith(
          (states) => BorderSide(
            color: states.contains(WidgetState.focused)
                ? colors.primary
                : colors.outlineVariant,
            width: states.contains(WidgetState.focused)
                ? borderThick
                : borderThin,
          ),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: button.copyWith(
        minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
        overlayColor: overlay(colors.primary),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: button.copyWith(
        padding: const WidgetStatePropertyAll(EdgeInsets.all(12)),
        overlayColor: overlay(colors.primary),
      ),
    ),
    inputDecorationTheme: InputDecorationThemeData(
      filled: true,
      fillColor: colors.surfaceContainerLowest,
      hoverColor: colors.primary.withValues(alpha: .03),
      contentPadding: const EdgeInsets.all(20),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(controlRadius),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        borderSide: BorderSide(color: colors.outlineVariant, width: borderThin),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        borderSide: BorderSide(color: colors.primary, width: borderThick),
      ),
      alignLabelWithHint: true,
    ),
    dividerTheme: DividerThemeData(
      color: colors.outlineVariant.withValues(alpha: .6),
      thickness: borderThin,
      space: borderThin,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      shape: shape,
    ),
  );
}

class ContentArea extends StatelessWidget {
  const ContentArea({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final spacing = UiSpacing.of(context);
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: spacing.contentWidth),
        child: Padding(padding: EdgeInsets.all(spacing.inset), child: child),
      ),
    );
  }
}
